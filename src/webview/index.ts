/**
 * Webview entry point: connects the rich-text editor to the extension host.
 */
import './editor.css'

import type { FromWebview, ToWebview } from '../shared/protocol'
import { openEditor, type RichEditor } from './editor'

interface VsCodeApi {
  postMessage(message: FromWebview): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const root = document.getElementById('app')!

let editor: RichEditor | null = null
const imageWaiters = new Map<number, { resolve: (src: string) => void; reject: (err: Error) => void }>()
let nextImageId = 1

function saveImage(file: File): Promise<string> {
  const id = nextImageId++
  return file.arrayBuffer().then(
    (buf) =>
      new Promise<string>((resolve, reject) => {
        imageWaiters.set(id, { resolve, reject })
        vscode.postMessage({ type: 'saveImage', id, name: file.name || 'image.png', data: new Uint8Array(buf) })
      }),
  )
}

function setColors(colors: 'github' | 'editor'): void {
  document.body.classList.toggle('gmw-colors-editor', colors === 'editor')
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to dashes. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

function openLink(href: string): void {
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1)).toLowerCase()
    const heading = [...root.querySelectorAll('.ProseMirror :is(h1, h2, h3, h4, h5, h6)')].find(
      (h) => slug(h.textContent ?? '') === id,
    )
    heading?.scrollIntoView({ block: 'start' })
    return
  }
  vscode.postMessage({ type: 'openLink', href })
}

async function handle(msg: ToWebview): Promise<void> {
  switch (msg.type) {
    case 'init':
      setColors(msg.colors)
      if (editor) {
        editor.load(msg.text)
        return
      }
      try {
        editor = await openEditor({
          root,
          fileText: msg.text,
          images: { docBase: msg.docBase, rootBase: msg.rootBase },
          onFileChange: (text) => vscode.postMessage({ type: 'edit', text }),
          onNotice: (message, level) => vscode.postMessage({ type: 'notice', message, level }),
          saveImage,
          openLink,
        })
        editor.focus()
      } catch (err) {
        console.error('[Markdown WYSIWYG]', err)
        root.textContent = `The rich text editor could not open this file: ${(err as Error).message}`
        vscode.postMessage({ type: 'notice', message: `Markdown WYSIWYG: ${(err as Error).message}`, level: 'error' })
      }
      return
    case 'update':
      editor?.load(msg.text)
      return
    case 'flush':
      vscode.postMessage({ type: 'flushed', id: msg.id, text: editor?.takePending() ?? null })
      return
    case 'imageSaved': {
      const waiter = imageWaiters.get(msg.id)
      imageWaiters.delete(msg.id)
      if (msg.src) waiter?.resolve(msg.src)
      else waiter?.reject(new Error(msg.error ?? 'unknown error'))
      return
    }
    case 'colors':
      setColors(msg.colors)
      return
  }
}

// Handle messages in order: an update must not overtake the init before it.
let queue: Promise<void> = Promise.resolve()
window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const msg = e.data
  // Answer flushes at once: a save is waiting for them.
  if (msg.type === 'flush' || msg.type === 'imageSaved') void handle(msg)
  else queue = queue.then(() => handle(msg))
})

// Send pending edits when the user moves to another editor or window.
window.addEventListener('blur', () => editor?.flush())
document.addEventListener('visibilitychange', () => editor?.flush())

vscode.postMessage({ type: 'ready' })
