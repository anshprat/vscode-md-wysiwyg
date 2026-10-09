/** Messages between the extension host and the rich-text webview. */

export interface InitMessage {
  type: 'init'
  /** Full content of the Markdown file. */
  text: string
  /** Webview URL of the file's folder (ends with `/`), for relative images. */
  docBase?: string
  /** Webview URL of the workspace folder (ends with `/`), for `/root-relative` images. */
  rootBase?: string
  colors: 'github' | 'editor'
}

export type ToWebview =
  | InitMessage
  /** The document changed outside this editor (source editor, undo, git...). */
  | { type: 'update'; text: string }
  /** Answer with `flushed` right away (sent before the document is saved). */
  | { type: 'flush'; id: number }
  | { type: 'imageSaved'; id: number; src?: string; error?: string }
  | { type: 'colors'; colors: 'github' | 'editor' }

export type FromWebview =
  | { type: 'ready' }
  /** New full content of the file after the user edited it. */
  | { type: 'edit'; text: string }
  /** Answer to `flush`: the pending content, or null when nothing is pending. */
  | { type: 'flushed'; id: number; text: string | null }
  | { type: 'notice'; message: string; level: 'info' | 'error' }
  | { type: 'openLink'; href: string }
  | { type: 'saveImage'; id: number; name: string; data: Uint8Array }
