/**
 * Webview test: loads the built webview (dist/webview.js + .css) in Chromium
 * with a mock VS Code API and the production CSP, and drives the editor.
 *
 *   npm run test:webview            # headless
 *   HEADED=1 npm run test:webview   # watch it run
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR ?? tmpdir()
const ORIGIN = 'https://webview.test'

const README = `# Acme Docs

Some *intro* text with __bold__ and a [ref link][docs] and a [guide](docs/guide.md).

![logo](docs/logo.png) ![root](/assets/root.png) ![badge](https://img.shields.io/badge/build-passing-green)

- one
- two
- three

| Name | Value |
|------|-------|
| a    | 1     |

\`\`\`js
const answer = 42
\`\`\`

<p align="center">
  <b>HTML block</b>
</p>

## Setup

Last paragraph.

[docs]: https://example.com/docs
`

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const CSP = [
  `default-src 'none'`,
  `img-src ${ORIGIN} https: http: data: blob:`,
  `style-src ${ORIGIN} 'unsafe-inline'`,
  `font-src ${ORIGIN} data:`,
  `script-src 'nonce-test'`,
].join('; ')

/** Mock of the extension host: answers like provider.ts does. */
const HOST = `
window.__host = { doc: ${JSON.stringify(README)}, messages: [], windowKeys: [], windowClicks: 0, csp: [] };
document.addEventListener('securitypolicyviolation', (e) => window.__host.csp.push(e.violatedDirective + ' ' + e.blockedURI));
window.addEventListener('keydown', (e) => window.__host.windowKeys.push((e.metaKey || e.ctrlKey ? 'Mod-' : '') + e.key));
window.addEventListener('click', () => window.__host.windowClicks++);
window.acquireVsCodeApi = () => ({
  postMessage(msg) {
    const host = window.__host;
    host.messages.push(msg);
    const reply = (m) => setTimeout(() => window.postMessage(m, '*'), 5);
    if (msg.type === 'ready') reply({ type: 'init', text: host.doc, docBase: '${ORIGIN}/ws/', rootBase: '${ORIGIN}/ws/', colors: 'github' });
    if (msg.type === 'edit') host.doc = msg.text;
    if (msg.type === 'flushed' && msg.text !== null) host.doc = msg.text;
    if (msg.type === 'saveImage') reply({ type: 'imageSaved', id: msg.id, src: 'images/' + msg.name });
  },
});
`

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<link rel="stylesheet" href="${ORIGIN}/dist/webview.css">
</head><body class="vscode-light"><div id="app" class="gmw-root"></div>
<script nonce="test">${HOST}</script>
<script nonce="test" src="${ORIGIN}/dist/webview.js"></script>
</body></html>`

const browser = await chromium.launch({ headless: !process.env.HEADED })
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
const imageRequests = []
await context.route(`${ORIGIN}/**`, (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: page })
  if (url.pathname.startsWith('/dist/')) {
    const file = join(root, url.pathname)
    return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(file) })
  }
  if (url.pathname.startsWith('/ws/')) {
    imageRequests.push(url.pathname)
    return route.fulfill({ contentType: 'image/png', body: PNG })
  }
  return route.fulfill({ status: 404, body: 'not found' })
})
await context.route('https://img.shields.io/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }))

const tab = await context.newPage()
const errors = []
tab.on('pageerror', (err) => errors.push(err.message))
const host = () => tab.evaluate(() => window.__host)
const doc = async () => (await host()).doc
const edits = async () => (await host()).messages.filter((m) => m.type === 'edit').length
const settle = () => tab.waitForTimeout(500)
const post = (msg) => tab.evaluate((m) => window.postMessage(m, '*'), msg)
const pm = '.gmw-root .ProseMirror'

let failures = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures++
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`)
    await tab.screenshot({ path: join(shotDir, `mdw-webview-fail-${failures}.png`) }).catch(() => {})
  }
}

console.log('webview: Markdown WYSIWYG')

await step('opens the editor with GitHub styles', async () => {
  await tab.goto(`${ORIGIN}/index.html`)
  await tab.waitForSelector(`${pm}.markdown-body h1`, { timeout: 15000 })
  assert.equal(await tab.locator(`${pm} h1`).textContent(), 'Acme Docs')
  assert.equal(await tab.locator(`${pm} .milkdown-table-block`).count(), 1)
  assert.equal(await tab.locator('.milkdown-top-bar').count(), 1)
  const bg = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.equal(bg, 'rgb(255, 255, 255)')
})

await step('opening the editor does not change the file', async () => {
  await settle()
  assert.equal(await edits(), 0)
  assert.equal(await doc(), README)
})

await step('resolves relative, root-relative and web images', async () => {
  const srcs = await tab.locator(`${pm} img`).evaluateAll((imgs) => imgs.map((i) => i.src))
  assert.ok(srcs.includes(`${ORIGIN}/ws/docs/logo.png`), srcs.join(', '))
  assert.ok(srcs.includes(`${ORIGIN}/ws/assets/root.png`), srcs.join(', '))
  assert.ok(srcs.includes('https://img.shields.io/badge/build-passing-green'), srcs.join(', '))
})

await step('typing changes only the edited block in the file', async () => {
  await tab.locator(`${pm} p`, { hasText: 'Last paragraph.' }).click()
  await tab.keyboard.press('End')
  await tab.keyboard.type(' Added text.')
  await settle()
  assert.equal(await doc(), README.replace('Last paragraph.', 'Last paragraph. Added text.'))
})

await step('keyboard formatting follows the file style (bold as __)', async () => {
  await tab.keyboard.type(' ')
  await tab.keyboard.press('ControlOrMeta+b')
  await tab.keyboard.type('Strong')
  await tab.keyboard.press('ControlOrMeta+b')
  await settle()
  assert.match(await doc(), /Last paragraph\. Added text\. __Strong__\n/)
})

await step('undo is handled by the editor and not forwarded to VS Code', async () => {
  const before = (await host()).windowKeys.length
  await tab.keyboard.press('ControlOrMeta+z')
  await settle()
  const keys = (await host()).windowKeys.slice(before)
  assert.ok(!keys.some((k) => /^Mod-z$/i.test(k)), keys.join(','))
  assert.doesNotMatch(await doc(), /__Strong__/)
})

await step('a new list item keeps the list style and leaves other blocks intact', async () => {
  await tab.locator(`${pm} li`, { hasText: 'three' }).click()
  await tab.keyboard.press('End')
  await tab.keyboard.press('Enter')
  await tab.keyboard.type('four')
  await settle()
  const text = await doc()
  assert.ok(text.includes('- one\n- two\n- three\n- four\n'), text)
  assert.ok(text.includes('Some *intro* text with __bold__ and a [ref link][docs]'), text)
  assert.ok(text.includes('| Name | Value |\n|------|-------|\n| a    | 1     |'), text)
  assert.ok(text.includes('<p align="center">\n  <b>HTML block</b>\n</p>'), text)
  assert.ok(text.includes('[docs]: https://example.com/docs'), text)
})

await step('a save gets pending edits at once (no debounce wait)', async () => {
  await tab.keyboard.type(' five')
  await post({ type: 'flush', id: 7 })
  await tab.waitForTimeout(50)
  const flushed = (await host()).messages.find((m) => m.type === 'flushed' && m.id === 7)
  assert.ok(flushed, 'no flushed message')
  assert.ok(flushed.text?.includes('- four five\n'), String(flushed.text))
  await settle()
  const after = (await host()).messages.filter((m) => m.type === 'edit').at(-1)
  assert.ok(!after?.text.includes(' five') || after.text === flushed.text, 'pending edit was sent twice')
})

await step('clicking a link places the cursor; Cmd/Ctrl+click opens it', async () => {
  const link = tab.locator(`${pm} a`, { hasText: 'guide' })
  const clicksBefore = (await host()).windowClicks
  await link.click()
  assert.equal((await host()).windowClicks, clicksBefore, 'click reached VS Code’s link handler')
  assert.equal((await host()).messages.filter((m) => m.type === 'openLink').length, 0)
  await link.click({ modifiers: ['ControlOrMeta'] })
  const open = (await host()).messages.filter((m) => m.type === 'openLink')
  assert.deepEqual(
    open.map((m) => m.href),
    ['docs/guide.md'],
  )
})

await step('pasting an image saves it as a file and links it', async () => {
  await tab.locator(`${pm} p`, { hasText: 'Last paragraph.' }).click()
  await tab.keyboard.press('End')
  await tab.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'image.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const target = document.querySelector('.gmw-root .ProseMirror')
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PNG.toString('base64'))
  await settle()
  const saved = (await host()).messages.filter((m) => m.type === 'saveImage')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].name, 'image.png')
  assert.match(await doc(), /!\[image\]\(images\/image\.png\)/)
})

await step('changes made outside the editor show up', async () => {
  const text = (await doc()) + '\nFrom source.\n'
  await tab.evaluate((t) => (window.__host.doc = t), text)
  await post({ type: 'update', text })
  await tab.locator(`${pm} p`, { hasText: 'From source.' }).waitFor()
  await settle()
  assert.equal(await doc(), text, 'reloading sent an edit back')
})

await step('follows the dark theme', async () => {
  await tab.evaluate(() => document.body.classList.replace('vscode-light', 'vscode-dark'))
  const bg = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.equal(bg, 'rgb(13, 17, 23)')
  const h1 = await tab.locator(`${pm} h1`).evaluate((h) => getComputedStyle(h).color)
  assert.equal(h1, 'rgb(240, 246, 252)')
  await tab.screenshot({ path: join(shotDir, 'mdw-webview-dark.png'), fullPage: true })
})

await step('no CSP violations or page errors', async () => {
  assert.deepEqual((await host()).csp, [])
  assert.deepEqual(errors, [])
})

await tab.evaluate(() => document.body.classList.replace('vscode-dark', 'vscode-light'))
await tab.screenshot({ path: join(shotDir, 'mdw-webview-light.png'), fullPage: true })
await browser.close()
console.log(`screenshots: ${shotDir}`)
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed')
process.exit(failures ? 1 : 0)
