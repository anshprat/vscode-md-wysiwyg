export interface SplitDoc {
  /** Front matter block including its fences and trailing newline, or ''. */
  frontMatter: string
  body: string
}

// YAML (---) or TOML (+++) front matter at the very start of the file.
const FRONT_MATTER = /^(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/

/**
 * Splits off front matter. The WYSIWYG editor does not understand it and
 * would render it as a horizontal rule plus text, so it is kept aside and
 * re-attached unchanged.
 */
export function splitFrontMatter(md: string): SplitDoc {
  const m = FRONT_MATTER.exec(md)
  if (!m) return { frontMatter: '', body: md }
  return { frontMatter: m[0], body: md.slice(m[0].length) }
}
