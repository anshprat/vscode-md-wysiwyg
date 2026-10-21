import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * CodeMirror theme for code blocks, built on GitHub's own CSS variables
 * (Primer + "prettylights" syntax colors), so it follows GitHub's light,
 * dark and high-contrast themes automatically.
 */
const v = (name: string, fallback: string) => `var(--color-prettylights-syntax-${name}, ${fallback})`

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('comment', '#6e7781') },
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: v('keyword', '#cf222e') },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: v('string', '#0a3069') },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name), t.standard(t.name)], color: v('constant', '#0550ae') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace], color: v('entity', '#6639ba') },
  { tag: [t.tagName], color: v('entity-tag', '#116329') },
  { tag: [t.attributeName, t.propertyName], color: v('constant', '#0550ae') },
  { tag: [t.variableName, t.definition(t.variableName)], color: v('variable', '#953800') },
  { tag: [t.heading], color: v('markup-heading', '#0550ae'), fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.link, t.url], color: v('string', '#0a3069'), textDecoration: 'underline' },
  { tag: [t.inserted], color: v('markup-inserted-text', '#116329') },
  { tag: [t.deleted], color: v('markup-deleted-text', '#82071e') },
  { tag: [t.invalid], color: v('invalid-illegal-text', '#f6f8fa') },
])

const base = EditorView.theme({
  '&': {
    color: 'var(--fgColor-default)',
    backgroundColor: 'var(--bgColor-muted)',
    fontSize: '85%',
  },
  '.cm-content': { fontFamily: 'var(--fontStack-monospace, ui-monospace, SFMono-Regular, monospace)', caretColor: 'var(--fgColor-default)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fgColor-default)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection-bgColor, rgba(84, 174, 255, 0.4))',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bgColor-muted)',
    color: 'var(--fgColor-muted)',
    border: 'none',
  },
  // basicSetup highlights the active line with a light-theme color; GitHub
  // shows code blocks without it.
  '&.cm-editor .cm-activeLine, &.cm-editor .cm-activeLineGutter': { backgroundColor: 'transparent' },
})

export const githubCodeTheme: Extension = [base, syntaxHighlighting(highlight)]
