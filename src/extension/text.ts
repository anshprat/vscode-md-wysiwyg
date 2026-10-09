/** Pure text helpers for the extension host (no `vscode` import, unit tested). */

export interface TextChange {
  /** Offset of the first replaced character. */
  start: number
  /** Offset just past the last replaced character (in the old text). */
  end: number
  /** Replacement text. */
  text: string
}

/**
 * The smallest single replacement that turns `before` into `after`.
 * Applying only this range (not the whole document) keeps the source
 * editor's cursor, folding and undo steps intact when both views are open.
 * Returns null when the texts are equal.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  // Do not split a surrogate pair or a CRLF.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--
  if (start > 0 && before[start - 1] === '\r') start--

  let endB = before.length
  let endA = after.length
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB--
    endA--
  }
  if (endB < before.length && isLowSurrogate(before.charCodeAt(endB))) {
    endB++
    endA++
  }
  if (endB < before.length && before[endB] === '\n' && endB > 0 && before[endB - 1] === '\r') {
    endB++
    endA++
  }
  return { start, end: endB, text: after.slice(start, endA) }
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff

/**
 * A safe file name for a pasted or dropped image. Clipboard images are
 * usually called `image.png`; spaces become dashes so the Markdown link
 * needs no escaping.
 */
export function imageFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKC')
    .replace(/[\s/\\?%*:|"<>#]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return `${stem || 'image'}.${ext || 'png'}`
}

/** `image.png`, `image-1.png`, `image-2.png`, ... */
export function numberedFileName(name: string, n: number): string {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`
}

/**
 * Normalizes the `imageFolder` setting to a relative POSIX path without
 * leading or trailing slashes ('' = the Markdown file's own folder).
 */
export function normalizeImageFolder(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join('/')
}

/** Markdown link target for an image saved at `folder/fileName`. */
export function imageLink(folder: string, fileName: string): string {
  const path = folder ? `${folder}/${fileName}` : fileName
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Splits a link from the document into its path and fragment, decoding
 * percent escapes. Returns null for links with a scheme (http:, mailto:...).
 */
export function relativeLinkTarget(href: string): { path: string; fragment: string } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null
  const hash = href.indexOf('#')
  const rawPath = hash >= 0 ? href.slice(0, hash) : href
  const fragment = hash >= 0 ? href.slice(hash + 1) : ''
  let path = rawPath.split('?')[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep the raw path.
  }
  return { path, fragment }
}
