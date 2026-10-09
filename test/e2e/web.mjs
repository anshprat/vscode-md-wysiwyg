/**
 * Smoke test of the web build (vscode.dev, github.dev): starts VS Code for
 * the Web with this extension (@vscode/test-web) and opens a Markdown file in
 * the rich-text editor.
 *
 *   npm run test:web
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR ?? tmpdir()
const port = 3123

const ws = mkdtempSync(join(tmpdir(), 'mdw-web-'))
mkdirSync(join(ws, 'docs'))
writeFileSync(join(ws, 'README.md'), '# Web Docs\n\n* one\n* two\n\nLast paragraph.\n')

const server = spawn(
  'npx',
  [
    'vscode-test-web',
    '--browser=none',
    '--quality=stable',
    `--port=${port}`,
    `--extensionDevelopmentPath=${root}`,
    ws,
  ],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
)
const ready = new Promise((res, rej) => {
  const onData = (d) => (String(d).includes(`localhost:${port}`) ? res() : undefined)
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
  server.on('exit', (code) => rej(new Error(`vscode-test-web exited with ${code}`)))
  setTimeout(() => rej(new Error('vscode-test-web did not start')), 240000)
})

let failures = 0
const browser = await chromium.launch({ headless: !process.env.HEADED })
try {
  await ready
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${port}`)
  await page.waitForSelector('.monaco-workbench', { timeout: 120000 })
  await page.waitForTimeout(3000)

  async function step(name, fn) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (err) {
      failures++
      console.log(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`)
      await page.screenshot({ path: join(shotDir, `mdw-web-fail-${failures}.png`) }).catch(() => {})
    }
  }

  console.log('web: Markdown WYSIWYG')
  let frame
  await step('opens a Markdown file in the rich text editor', async () => {
    // The web build has no file search for Quick Open; use the Explorer.
    await page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'README.md' }).click()
    await page.locator('.tab.active', { hasText: 'README.md' }).waitFor()
    await page.keyboard.press('F1')
    await page.locator('.quick-input-widget input:visible').fill('>Markdown WYSIWYG: Open in Rich Text Editor')
    await page.locator('.quick-input-list .monaco-list-row', { hasText: 'Open in Rich Text Editor' }).first().waitFor()
    await page.keyboard.press('Enter')
    const end = Date.now() + 30000
    while (!frame && Date.now() < end) {
      for (const f of page.frames()) {
        if (await f.locator('.ProseMirror h1', { hasText: 'Web Docs' }).count().catch(() => 0)) frame = f
      }
      await page.waitForTimeout(300)
    }
    assert.ok(frame, 'rich text editor not found')
  })

  await step('typing marks the file as changed', async () => {
    await frame.locator('.ProseMirror p', { hasText: 'Last paragraph.' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' From the web.')
    await page.locator('.tab.dirty', { hasText: 'README.md' }).waitFor({ timeout: 10000 })
    await page.screenshot({ path: join(shotDir, 'mdw-web.png') })
  })

  await step('no extension errors', async () => {
    assert.deepEqual(errors.filter((e) => /mdWysiwyg|md-wysiwyg|webview/i.test(e)), [])
  })
} finally {
  await browser.close()
  server.kill()
}
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed')
process.exit(failures ? 1 : 0)
