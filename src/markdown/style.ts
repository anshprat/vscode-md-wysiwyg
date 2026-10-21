import type { Options } from 'remark-stringify'

/**
 * Serializer options that match the conventions already used in a document,
 * so text the user adds or edits looks like the rest of the file.
 */
export type MarkdownStyle = Pick<
  Options,
  'bullet' | 'emphasis' | 'strong' | 'fence' | 'rule' | 'incrementListMarker'
>

function majority<T extends string>(counts: Record<T, number>, fallback: T): T {
  let best = fallback
  let bestCount = 0
  for (const [k, n] of Object.entries(counts) as Array<[T, number]>) {
    if (n > bestCount) {
      best = k
      bestCount = n
    }
  }
  return best
}

function count(md: string, re: RegExp): number {
  return md.match(re)?.length ?? 0
}

export function detectStyle(md: string): MarkdownStyle {
  // Drop fenced code so code samples do not skew the counts.
  const text = md.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')

  const bullet = majority<'-' | '*' | '+'>(
    {
      '-': count(text, /^[ \t]*-[ \t]+\S/gm),
      '*': count(text, /^[ \t]*\*[ \t]+\S/gm),
      '+': count(text, /^[ \t]*\+[ \t]+\S/gm),
    },
    '-',
  )
  const emphasis = majority<'*' | '_'>(
    {
      '*': count(text, /(?<![*\w])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![*\w])/g),
      _: count(text, /(?<![_\w])_(?![\s_])[^_\n]+?(?<![\s_])_(?![_\w])/g),
    },
    '*',
  )
  const strong = majority<'*' | '_'>(
    {
      '*': count(text, /\*\*(?!\s)[^*\n]+?(?<!\s)\*\*/g),
      _: count(text, /__(?!\s)[^_\n]+?(?<!\s)__/g),
    },
    '*',
  )
  const fence = majority<'`' | '~'>({ '`': count(md, /^[ \t]*```/gm), '~': count(md, /^[ \t]*~~~/gm) }, '`')
  const rule = majority<'-' | '*' | '_'>(
    {
      '-': count(text, /^[ \t]*(?:-[ \t]*){3,}$/gm),
      '*': count(text, /^[ \t]*(?:\*[ \t]*){3,}$/gm),
      _: count(text, /^[ \t]*(?:_[ \t]*){3,}$/gm),
    },
    '-',
  )
  // "1. 1. 1." style ordered lists: keep every marker the same.
  const ordered = text.match(/^[ \t]*\d+[.)][ \t]+\S/gm) ?? []
  const ones = ordered.filter((l) => /^[ \t]*1[.)]/.test(l)).length
  const incrementListMarker = !(ordered.length >= 2 && ones === ordered.length)

  return { bullet, emphasis, strong, fence, rule, incrementListMarker }
}
