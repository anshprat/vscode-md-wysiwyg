import { splitFrontMatter } from './frontmatter'
import { mergePreserving } from './preserve'
import { detectStyle, type MarkdownStyle } from './style'

/**
 * Converts between the file content held by GitHub's source editor and the
 * Markdown the WYSIWYG editor works with, keeping everything the editor
 * cannot see (BOM, line endings, front matter, untouched blocks) unchanged.
 */
export class MarkdownSession {
  /** Markdown to load into the WYSIWYG editor. */
  readonly body: string
  /** Serializer options matching the file's existing conventions. */
  readonly style: MarkdownStyle

  private readonly bom: string
  private readonly crlf: boolean
  private readonly frontMatter: string
  private base: string | null = null

  constructor(readonly original: string) {
    this.bom = original.startsWith('﻿') ? '﻿' : ''
    const text = original.slice(this.bom.length)
    this.crlf = /\r\n/.test(text) && !/(^|[^\r])\n/.test(text)
    const split = splitFrontMatter(text.replace(/\r\n/g, '\n'))
    this.frontMatter = split.frontMatter
    this.body = split.body
    this.style = detectStyle(this.body)
  }

  /** Records what the editor produced right after loading `body`. */
  setBase(editorMarkdown: string): void {
    this.base = editorMarkdown
  }

  /** Returns the full file content for the editor's current Markdown. */
  toFile(editorMarkdown: string): string {
    if (this.base === null) throw new Error('MarkdownSession: setBase() was not called')
    if (editorMarkdown === this.base) return this.original
    let out = this.frontMatter + mergePreserving(this.body, this.base, editorMarkdown)
    if (this.crlf) out = out.replace(/\n/g, '\r\n')
    return this.bom + out
  }
}
