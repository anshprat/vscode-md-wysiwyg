import * as vscode from 'vscode'

import type { FromWebview, InitMessage, ToWebview } from '../shared/protocol'
import { imageFileName, imageLink, minimalChange, normalizeImageFolder, numberedFileName, relativeLinkTarget } from './text'

export const VIEW_TYPE = 'mdWysiwyg.editor'

/** How long a save waits for the webview to hand over pending edits. */
const FLUSH_TIMEOUT_MS = 1000

/**
 * One open rich-text editor. The TextDocument is the source of truth: the
 * webview sends the full new file content after each edit, and the panel
 * applies only the changed range. Changes made elsewhere (source editor,
 * undo, git, formatters) go back to the webview.
 */
class RichPanel {
  /** The file content the webview currently shows. */
  private synced: string
  /** Serializes document edits so they apply in the order they were made. */
  private applying: Promise<unknown> = Promise.resolve()
  /** Edits from the webview not applied yet. */
  private queued = 0
  private flushes = new Map<number, (text: string | null) => void>()
  private nextId = 1
  private ready = false

  constructor(
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
  ) {
    this.synced = document.getText()
  }

  post(message: ToWebview): void {
    void this.panel.webview.postMessage(message)
  }

  init(colors: InitMessage['colors']): void {
    this.ready = true
    this.synced = this.document.getText()
    const webview = this.panel.webview
    const dir = documentFolder(this.document.uri)
    const root = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri
    this.post({
      type: 'init',
      text: this.synced,
      docBase: dir && withSlash(webview.asWebviewUri(dir).toString()),
      rootBase: root && withSlash(webview.asWebviewUri(root).toString()),
      colors,
    })
  }

  /** Applies the webview's content to the document. */
  edit(text: string): Promise<unknown> {
    this.synced = text
    this.queued++
    this.applying = this.applying.then(async () => {
      try {
        const change = minimalChange(this.document.getText(), text)
        if (!change) return
        const edit = new vscode.WorkspaceEdit()
        edit.replace(this.document.uri, this.range(change.start, change.end), change.text)
        if (!(await vscode.workspace.applyEdit(edit))) {
          void vscode.window.showErrorMessage('Markdown WYSIWYG: could not update the document.')
        }
      } finally {
        this.queued--
        // Forward any change made elsewhere while the edits were applying.
        if (this.queued === 0) this.documentChanged()
      }
    })
    return this.applying
  }

  /** Called on every document change; forwards changes made elsewhere. */
  documentChanged(): void {
    // While webview edits are applying, the document passes through older
    // versions of the webview's text; sending those back would undo typing.
    if (!this.ready || this.queued > 0) return
    const text = this.document.getText()
    if (text === this.synced) return
    this.synced = text
    this.post({ type: 'update', text })
  }

  /**
   * Gets edits the webview has not sent yet (it debounces typing) and
   * returns them as text edits for the save in progress.
   */
  async flushForSave(): Promise<vscode.TextEdit[]> {
    if (!this.ready) return []
    const id = this.nextId++
    const text = await new Promise<string | null>((resolve) => {
      this.flushes.set(id, resolve)
      this.post({ type: 'flush', id })
      setTimeout(() => {
        this.flushes.delete(id)
        resolve(null)
      }, FLUSH_TIMEOUT_MS)
    })
    // Edits sent just before the flush may still be applying.
    await this.applying
    if (text === null) return []
    this.synced = text
    const change = minimalChange(this.document.getText(), text)
    return change ? [vscode.TextEdit.replace(this.range(change.start, change.end), change.text)] : []
  }

  flushed(id: number, text: string | null): void {
    this.flushes.get(id)?.(text)
    this.flushes.delete(id)
  }

  private range(start: number, end: number): vscode.Range {
    return new vscode.Range(this.document.positionAt(start), this.document.positionAt(end))
  }
}

export class RichTextEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly panels = new Set<RichPanel>()

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length === 0) return
        for (const p of this.panels) if (p.document === e.document) p.documentChanged()
      }),
      vscode.workspace.onWillSaveTextDocument((e) => {
        const open = [...this.panels].filter((p) => p.document === e.document)
        if (open.length === 0) return
        e.waitUntil(Promise.all(open.map((p) => p.flushForSave())).then((edits) => edits.flat().slice(0, 1)))
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('mdWysiwyg.colors')) return
        for (const p of this.panels) p.post({ type: 'colors', colors: colorsSetting() })
      }),
    )
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const rich = new RichPanel(document, panel)
    this.panels.add(rich)

    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist')
    const roots = [dist, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)]
    const dir = documentFolder(document.uri)
    if (dir) roots.push(dir)
    panel.webview.options = { enableScripts: true, localResourceRoots: roots }
    panel.webview.html = this.html(panel.webview, dist)

    const sub = panel.webview.onDidReceiveMessage((msg: FromWebview) => {
      switch (msg.type) {
        case 'ready':
          rich.init(colorsSetting())
          break
        case 'edit':
          void rich.edit(msg.text)
          break
        case 'flushed':
          rich.flushed(msg.id, msg.text)
          break
        case 'notice':
          if (msg.level === 'error') void vscode.window.showErrorMessage(msg.message)
          else void vscode.window.showInformationMessage(msg.message)
          break
        case 'openLink':
          void openLink(document.uri, msg.href)
          break
        case 'saveImage':
          void saveImage(document.uri, msg.name, msg.data).then(
            (src) => rich.post({ type: 'imageSaved', id: msg.id, src }),
            (err: Error) => rich.post({ type: 'imageSaved', id: msg.id, error: err.message }),
          )
          break
      }
    })
    panel.onDidDispose(() => {
      sub.dispose()
      this.panels.delete(rich)
    })
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = createNonce()
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, name)).toString()
    // Milkdown and CodeMirror set inline styles, so style-src needs 'unsafe-inline'.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ')
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('webview.css')}">
</head>
<body>
<div id="app" class="gmw-root"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`
  }
}

function colorsSetting(): InitMessage['colors'] {
  return vscode.workspace.getConfiguration('mdWysiwyg').get('colors') === 'editor' ? 'editor' : 'github'
}

function documentFolder(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme === 'untitled') return vscode.workspace.workspaceFolders?.[0]?.uri
  return vscode.Uri.joinPath(uri, '..')
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : url + '/'
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** Opens a link clicked in the editor: web links outside, relative links in VS Code. */
async function openLink(docUri: vscode.Uri, href: string): Promise<void> {
  const target = relativeLinkTarget(href)
  if (!target) {
    const uri = vscode.Uri.parse(href)
    if (['http', 'https', 'mailto'].includes(uri.scheme)) await vscode.env.openExternal(uri)
    return
  }
  if (!target.path) return // In-page anchors are handled in the webview.
  const base = target.path.startsWith('/')
    ? vscode.workspace.getWorkspaceFolder(docUri)?.uri
    : documentFolder(docUri)
  if (!base) return
  const uri = vscode.Uri.joinPath(base, target.path)
  try {
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', uri)
      return
    }
  } catch {
    void vscode.window.showWarningMessage(`Markdown WYSIWYG: ${target.path} does not exist.`)
    return
  }
  await vscode.commands.executeCommand('vscode.open', uri)
}

/** Writes a pasted or dropped image next to the document and returns its Markdown link. */
async function saveImage(docUri: vscode.Uri, name: string, data: Uint8Array): Promise<string> {
  if (docUri.scheme === 'untitled') throw new Error('Save the file first, then paste the image again.')
  const folder = normalizeImageFolder(vscode.workspace.getConfiguration('mdWysiwyg', docUri).get('imageFolder', ''))
  const dir = folder ? vscode.Uri.joinPath(docUri, '..', ...folder.split('/')) : vscode.Uri.joinPath(docUri, '..')
  await vscode.workspace.fs.createDirectory(dir)
  const base = imageFileName(name)
  for (let n = 0; n < 1000; n++) {
    const fileName = numberedFileName(base, n)
    const uri = vscode.Uri.joinPath(dir, fileName)
    if (await exists(uri)) continue
    await vscode.workspace.fs.writeFile(uri, data)
    return imageLink(folder, fileName)
  }
  throw new Error(`Too many files named ${base}`)
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}
