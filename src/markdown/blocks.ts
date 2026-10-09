import type { Root, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface Block {
  type: string
  /** Offset of the first character of the block in the source. */
  start: number
  /** Offset just past the last character of the block in the source. */
  end: number
  /** Exact source text of the block. */
  text: string
  /**
   * Style-independent identity of the block: node type plus its plain text.
   * Two serializations of the same content get the same key even when they
   * use different markers (`*` vs `_`, `-` vs `*`, reference vs inline links).
   */
  key: string
}

const parser = unified().use(remarkParse).use(remarkGfm)

export function parseMarkdown(md: string): Root {
  return parser.parse(md)
}

function nodeKey(node: RootContent): string {
  let type: string = node.type
  if (node.type === 'heading') type += node.depth
  else if (node.type === 'list') type += node.ordered ? ':ol' : ':ul'
  else if (node.type === 'code') type += ':' + (node.lang ?? '')
  const text = 'value' in node && typeof node.value === 'string' ? node.value : toString(node)
  return type + '\u0000' + text.replace(/\s+/g, ' ').trim()
}

/** Splits a Markdown document into its top-level blocks. */
export function splitBlocks(md: string): Block[] {
  const tree = parseMarkdown(md)
  const blocks: Block[] = []
  for (const node of tree.children) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null) continue
    blocks.push({ type: node.type, start, end, text: md.slice(start, end), key: nodeKey(node) })
  }
  return blocks
}
