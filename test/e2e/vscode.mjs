/**
 * End-to-end test in a real VS Code window: downloads VS Code (cached in
 * .vscode-test/), starts it with this extension in development mode and a
 * throwaway profile, and drives the editor with Playwright.
 *
 *   npm run test:vscode
 *   VSCODE_EXECUTABLE=/path/to/Code npm run test:vscode   # another build, e.g. Cursor
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { _electron as electron } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = process.env.SHOT_DIR ?? tmpdir()

const README = `# Acme Docs

Some *intro* text with __bold__ and a [guide](docs/guide.md).

![logo](docs/logo.png)

* one
* two

| Name | Value |
|------|-------|
| a    | 1     |

Last paragraph.

[docs]: https://example.com/docs
`

// 8x8 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH5QSAA7CAQ/xWpGkAAAAAElFTkSuQmCC',
  'base64',
)

const tmp = mkdtempSync(join(tmpdir(), 'mdw-vscode-'))
const ws = join(tmp, 'ws')
const userData = join(tmp, 'user')
mkdirSync(join(ws, 'docs'), { recursive: true })
mkdirSync(join(userData, 'User'), { recursive: true })
const readmePath = join(ws, 'README.md')
writeFileSync(readmePath, README)
writeFileSync(join(ws, 'docs/guide.md'), '# Guide\n')
writeFileSync(join(ws, 'docs/logo.png'), PNG)
const settingsPath = join(userData, 'User/settings.json')
writeFileSync(
  settingsPath,
  JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'security.workspace.trust.enabled': false,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'chat.disableAIFeatures': true,
    'workbench.tips.enabled': false,
    'window.dialogStyle': 'custom', // dialogs in the DOM, so the test can see them
  }),
)

let executablePath = process.env.VSCODE_EXECUTABLE ?? (await downloadAndUnzipVSCode(process.env.VSCODE_VERSION ?? 'stable'))
// Recent macOS builds name the binary "Code", not "Electron".
if (!existsSync(executablePath)) executablePath = join(dirname(executablePath), readdirSync(dirname(executablePath))[0])
console.log(`vscode: ${executablePath}`)
const isCursor = /cursor/i.test(executablePath)
const app = await electron.launch({
  executablePath,
  args: [
    ws,
    `--extensionDevelopmentPath=${root}`,
    `--user-data-dir=${userData}`,
    `--extensions-dir=${join(tmp, 'extensions')}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    '--new-window',
  ],
})
const win = await app.firstWindow()
await win.waitForSelector('.monaco-workbench', { timeout: 60000 })
// Cursor shows a login screen over the workbench on a fresh profile. The
// editor works without logging in, so hide it.
await win.waitForTimeout(3000)
await win.evaluate(() => document.querySelector('.onboarding-v2-overlay')?.remove())
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const disk = () => readFileSync(readmePath, 'utf8')

/** The frame that hosts the rich-text editor (VS Code nests webviews in iframes). */
async function editorFrame(heading = 'Acme Docs', timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const f of win.frames()) {
      if (!f.url().startsWith('vscode-webview://')) continue
      if (await f.locator('.gmw-root .ProseMirror h1', { hasText: heading }).count().catch(() => 0)) return f
    }
    await win.waitForTimeout(250)
  }
  throw new Error('rich text editor frame not found')
}

async function command(title) {
  await win.keyboard.press(`${mod}+Shift+P`)
  const input = win.locator('.quick-input-widget input:visible')
  await input.waitFor()
  await input.fill(`>${title}`)
  await win.locator('.quick-input-list .monaco-list-row', { hasText: title }).first().waitFor()
  await win.keyboard.press('Enter')
}

async function quickOpen(name) {
  await win.keyboard.press(`${mod}+P`)
  const input = win.locator('.quick-input-widget input:visible')
  await input.waitFor()
  await input.fill(name)
  await win.locator('.quick-input-list .monaco-list-row', { hasText: name }).first().waitFor()
  await win.keyboard.press('Enter')
}

let failures = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures++
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`)
    await win.screenshot({ path: join(shotDir, `mdw-vscode-fail-${failures}.png`) }).catch(() => {})
  }
}

console.log('vscode: Markdown WYSIWYG')
let frame

await step('the editor title has "Open in Rich Text Editor" for Markdown files', async () => {
  await quickOpen('README.md')
  await win.locator('.tab.active', { hasText: 'README.md' }).waitFor()
  const button = win.locator('.editor-actions [aria-label="Open in Rich Text Editor"]')
  try {
    await button.waitFor({ timeout: 8000 })
    await button.click()
  } catch {
    // Narrow editor title bars (Cursor's default layout) move the button to
    // the "..." menu, which is a native menu Playwright cannot click.
    console.log('    (title button not visible; using the Command Palette)')
    await command('Markdown WYSIWYG: Open in Rich Text Editor')
  }
})

await step('opens the rich text editor in place of the text editor', async () => {
  frame = await editorFrame()
  await frame.locator('.ProseMirror h1', { hasText: 'Acme Docs' }).waitFor()
  assert.equal(await win.locator('.tab', { hasText: 'README.md' }).count(), 1, 'README.md is open twice')
  assert.equal(await frame.locator('.ProseMirror .milkdown-table-block').count(), 1)
})

await step('follows the dark color theme', async () => {
  const bg = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.equal(bg, 'rgb(13, 17, 23)')
})

await step('shows images from the workspace', async () => {
  await frame.locator('.milkdown-image-inline img').first().waitFor()
  await frame.waitForFunction(() => document.querySelector('.milkdown-image-inline img')?.naturalWidth > 0, null, {
    timeout: 10000,
  })
})

await step('remembers rich text as the default for Markdown files', async () => {
  await win.waitForTimeout(500)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  assert.equal(settings['workbench.editorAssociations']?.['*.md'], 'mdWysiwyg.editor', JSON.stringify(settings))
})

await step('opening does not change or dirty the file', async () => {
  await win.waitForTimeout(800)
  assert.equal(await win.locator('.tab.dirty', { hasText: 'README.md' }).count(), 0)
  assert.equal(disk(), README)
})

await step('typing and saving at once writes only the edited block', async () => {
  await frame.locator('.ProseMirror p', { hasText: 'Last paragraph.' }).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' Added.')
  await win.keyboard.press(`${mod}+S`) // no wait: the save must pick up the debounced edit
  await win.waitForTimeout(1500)
  assert.equal(disk(), README.replace('Last paragraph.', 'Last paragraph. Added.'))
  assert.equal(await win.locator('.tab.dirty', { hasText: 'README.md' }).count(), 0)
})

await step('Cmd/Ctrl+Z undoes one step (not two)', async () => {
  await win.keyboard.type(' One.')
  await win.waitForTimeout(800)
  await win.keyboard.type(' Two.')
  await win.waitForTimeout(800)
  await win.keyboard.press(`${mod}+Z`)
  await win.waitForTimeout(500)
  await win.keyboard.press(`${mod}+S`)
  await win.waitForTimeout(1500)
  assert.equal(disk(), README.replace('Last paragraph.', 'Last paragraph. Added. One.'))
})

await step('a new list item keeps the * bullet style', async () => {
  await frame.locator('.ProseMirror li', { hasText: 'two' }).click()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  await win.keyboard.type('three')
  await win.keyboard.press(`${mod}+S`)
  await win.waitForTimeout(1500)
  const text = disk()
  assert.ok(text.includes('* one\n* two\n* three\n'), text)
  assert.ok(text.includes('| Name | Value |\n|------|-------|\n| a    | 1     |'), text)
  assert.ok(text.includes('[docs]: https://example.com/docs'), text)
})

await step('changes on disk show up in the editor', async () => {
  writeFileSync(readmePath, disk() + '\nWritten on disk.\n')
  await frame.locator('.ProseMirror p', { hasText: 'Written on disk.' }).waitFor({ timeout: 10000 })
})

await step('Cmd/Ctrl+click on a relative link opens the file', async () => {
  await frame.locator('.ProseMirror a', { hasText: 'guide' }).click({ modifiers: [mod] })
  await win.locator('.tab.active', { hasText: 'guide.md' }).waitFor({ timeout: 10000 })
  await win.screenshot({ path: join(shotDir, 'mdw-vscode-guide.png') })
  await win.locator('.tab', { hasText: 'README.md' }).click()
  frame = await editorFrame()
})

await win.screenshot({ path: join(shotDir, 'mdw-vscode-rich.png') })

await step('Cmd/Ctrl+click does not select the paragraph', async () => {
  const selected = await frame.locator('.ProseMirror .ProseMirror-selectednode').count()
  assert.equal(selected, 0)
})

await step('"Open Markdown Source" keeps unsaved edits and forgets the default', async () => {
  await frame.locator('.ProseMirror p', { hasText: 'Written on disk.' }).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' Unsaved.')
  await win.waitForTimeout(600)
  await command('Markdown WYSIWYG: Open Markdown Source')
  await win.locator('.monaco-editor .view-lines', { hasText: 'Written on disk. Unsaved.' }).waitFor({ timeout: 10000 })
  await win.waitForTimeout(500)
  assert.equal(await win.locator('.monaco-dialog-box').count(), 0, 'a save dialog appeared')
  // Cursor has no in-place "reopen with" command: with unsaved changes the
  // old tab stays open (closing it would ask to save).
  const tabs = await win.locator('.tab', { hasText: 'README.md' }).count()
  assert.equal(tabs, isCursor ? 2 : 1, `README.md is open in ${tabs} tabs`)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  assert.equal(settings['workbench.editorAssociations']?.['*.md'], undefined, JSON.stringify(settings))
})

await app.close()
console.log(`screenshots: ${shotDir}`)
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed')
process.exit(failures ? 1 : 0)
