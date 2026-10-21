/**
 * Image URL resolution for the WYSIWYG view.
 *
 * - Relative paths resolve against the Markdown file's folder, served through
 *   the webview's resource URL (`https://file+.vscode-resource...`).
 * - Root-relative paths (`/docs/img.png`) resolve against the workspace
 *   folder, the closest match to GitHub's repository root.
 * - Web images load directly (the webview's CSP allows them).
 *
 * Only the displayed `src` changes. The Markdown keeps the original URL.
 */

export interface ImageContext {
  /** Webview URL of the file's folder, ending with `/`. */
  docBase?: string
  /** Webview URL of the workspace folder, ending with `/`. */
  rootBase?: string
}

export function createImageResolver(ctx: ImageContext): (src: string) => string {
  return (src: string) => {
    if (!src) return src
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src // https:, data:, blob: ...
    if (src.startsWith('//')) return 'https:' + src
    try {
      if (src.startsWith('/')) return ctx.rootBase ? new URL(src.slice(1), ctx.rootBase).href : src
      return ctx.docBase ? new URL(src, ctx.docBase).href : src
    } catch {
      return src
    }
  }
}
