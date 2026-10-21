import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { splitFrontMatter } from '../../src/markdown/frontmatter'
import { mergePreserving } from '../../src/markdown/preserve'
import { MarkdownSession } from '../../src/markdown/session'
import { detectStyle } from '../../src/markdown/style'

/** Stand-in for the WYSIWYG editor: a normalizing parse + serialize. */
const normalize = (md: string) =>
  String(unified().use(remarkParse).use(remarkGfm).use(remarkStringify, { bullet: '*' }).processSync(md))

/** Simulates the user editing in the editor: edit the base text, re-normalize. */
function editInEditor(original: string, edit: (base: string) => string) {
  const base = normalize(original)
  const edited = normalize(edit(base))
  return { base, edited, merged: mergePreserving(original, base, edited) }
}

const DOC = `# Title

Some *intro* text with __bold__ and a [ref link][docs].

- one
- two
- three

| a | b |
|---|---|
| 1 | 2 |

<p align="center">
  <img src="logo.png" width="100">
</p>

Last paragraph.

[docs]: https://example.com/docs
`

describe('mergePreserving', () => {
  it('returns the original when nothing changed', () => {
    const base = normalize(DOC)
    expect(base).not.toBe(DOC) // normalization really does change things
    expect(mergePreserving(DOC, base, base)).toBe(DOC)
  })

  it('only rewrites the edited block', () => {
    const { merged } = editInEditor(DOC, (b) => b.replace('Last paragraph.', 'Last paragraph, edited.'))
    expect(merged).toBe(DOC.replace('Last paragraph.', 'Last paragraph, edited.'))
  })

  it('keeps reference definitions and untouched reference links', () => {
    const { merged } = editInEditor(DOC, (b) => b.replace('# Title', '# New title'))
    expect(merged).toContain('[ref link][docs]')
    expect(merged).toContain('[docs]: https://example.com/docs')
    expect(merged.startsWith('# New title\n\nSome *intro* text with __bold__')).toBe(true)
  })

  it('inserts a new block between untouched blocks', () => {
    const { merged } = editInEditor(DOC, (b) => b.replace('Last paragraph.', 'Inserted.\n\nLast paragraph.'))
    expect(merged).toBe(DOC.replace('Last paragraph.', 'Inserted.\n\nLast paragraph.'))
  })

  it('deletes a block', () => {
    const { merged } = editInEditor(DOC, (b) => b.replace('Last paragraph.\n\n', ''))
    expect(merged).toBe(DOC.replace('Last paragraph.\n\n', ''))
  })

  it('keeps blocks the editor dropped', () => {
    const original = 'Para one.\n\n<!-- keep me -->\n\nPara two.\n'
    const base = 'Para one.\n\nPara two.\n' // editor swallowed the comment
    const edited = 'Para one!\n\nPara two.\n'
    expect(mergePreserving(original, base, edited)).toBe('Para one!\n\n<!-- keep me -->\n\nPara two.\n')
  })

  it('pairs blocks whose text the editor changed while round-tripping', () => {
    const original = 'A \\_literal\\_ underscore.\n\nSecond.\n'
    const base = 'A _literal_ underscore.\n\nSecond.\n' // different plain text, same shape
    const edited = 'A _literal_ underscore.\n\nSecond!\n'
    expect(mergePreserving(original, base, edited)).toBe('A \\_literal\\_ underscore.\n\nSecond!\n')
  })

  it('handles an edit inside a list by rewriting only that list', () => {
    const { merged } = editInEditor(DOC, (b) => b.replace('* two', '* two and a half'))
    expect(merged).toContain('* one\n* two and a half\n* three')
    expect(merged).toContain('Some *intro* text with __bold__')
    expect(merged).toContain('|---|---|')
  })

  it('preserves a missing trailing newline', () => {
    const original = 'One\n\nTwo'
    const { merged } = editInEditor(original, (b) => b.replace('One', 'Uno'))
    expect(merged).toBe('Uno\n\nTwo')
  })

  it('handles an empty original', () => {
    expect(mergePreserving('', '', 'Hello\n')).toBe('Hello\n')
  })
})

describe('MarkdownSession', () => {
  it('keeps front matter, BOM and CRLF line endings', () => {
    const file = '﻿---\r\ntitle: x\r\n---\r\n# Hi\r\n\r\nBody *text*.\r\n'
    const s = new MarkdownSession(file)
    expect(s.body).toBe('# Hi\n\nBody *text*.\n')
    s.setBase(normalize(s.body))
    expect(s.toFile(normalize(s.body))).toBe(file)
    expect(s.toFile(normalize('# Hi\n\nBody *text*, edited.\n'))).toBe(
      '﻿---\r\ntitle: x\r\n---\r\n# Hi\r\n\r\nBody *text*, edited.\r\n',
    )
  })
})

describe('splitFrontMatter', () => {
  it('splits YAML front matter', () => {
    expect(splitFrontMatter('---\na: 1\n---\nbody')).toEqual({ frontMatter: '---\na: 1\n---\n', body: 'body' })
  })
  it('ignores a thematic break that is not front matter', () => {
    expect(splitFrontMatter('text\n---\nmore').frontMatter).toBe('')
  })
})

describe('detectStyle', () => {
  it('detects common conventions', () => {
    const style = detectStyle('* a\n* b\n\n_em_ and __strong__\n\n~~~js\nx\n~~~\n\n***\n\n1. x\n1. y\n')
    expect(style).toEqual({
      bullet: '*',
      emphasis: '_',
      strong: '_',
      fence: '~',
      rule: '*',
      incrementListMarker: false,
    })
  })
  it('falls back to GitHub-style defaults', () => {
    expect(detectStyle('Just text.')).toMatchObject({ bullet: '-', rule: '-', fence: '`' })
  })
})
