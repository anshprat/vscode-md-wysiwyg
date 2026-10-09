import { describe, expect, it } from 'vitest'

import {
  imageFileName,
  imageLink,
  minimalChange,
  normalizeImageFolder,
  numberedFileName,
  relativeLinkTarget,
} from '../../src/extension/text'

const apply = (before: string, after: string) => {
  const c = minimalChange(before, after)
  return c ? before.slice(0, c.start) + c.text + before.slice(c.end) : before
}

describe('minimalChange', () => {
  it('returns null for equal texts', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
  })

  it('replaces only the changed middle', () => {
    expect(minimalChange('# Title\n\nOne two.\n', '# Title\n\nOne three.\n')).toEqual({
      start: 14,
      end: 16,
      text: 'hree',
    })
  })

  it('handles inserts, deletes and edits at both ends', () => {
    for (const [a, b] of [
      ['abc', 'xabc'],
      ['abc', 'abcx'],
      ['abc', 'bc'],
      ['abc', 'ab'],
      ['', 'new'],
      ['old', ''],
      ['aaa', 'aaaa'],
    ]) {
      expect(apply(a, b)).toBe(b)
    }
  })

  it('does not split CRLF line endings or surrogate pairs', () => {
    const c1 = minimalChange('a\r\nb', 'a\r\n\r\nb')!
    expect(apply('a\r\nb', 'a\r\n\r\nb')).toBe('a\r\n\r\nb')
    expect('a\r\nb'.slice(c1.start, c1.end)).not.toMatch(/^\n/)
    const c2 = minimalChange('x😀y', 'x😃y')!
    expect(c2.text).toBe('😃')
    expect(apply('x😀y', 'x😃y')).toBe('x😃y')
  })
})

describe('image files', () => {
  it('builds safe file names', () => {
    expect(imageFileName('image.png')).toBe('image.png')
    expect(imageFileName('Screen Shot 2026-10-09 at 10.00.00.PNG')).toBe('Screen-Shot-2026-10-09-at-10.00.00.png')
    expect(imageFileName('')).toBe('image.png')
    expect(imageFileName('../evil/x.jpg')).toBe('evil-x.jpg')
  })

  it('numbers duplicates', () => {
    expect(numberedFileName('image.png', 0)).toBe('image.png')
    expect(numberedFileName('image.png', 2)).toBe('image-2.png')
  })

  it('normalizes the image folder setting', () => {
    expect(normalizeImageFolder('')).toBe('')
    expect(normalizeImageFolder('./images/')).toBe('images')
    expect(normalizeImageFolder('assets\\img')).toBe('assets/img')
  })

  it('builds Markdown links', () => {
    expect(imageLink('', 'image.png')).toBe('image.png')
    expect(imageLink('images', 'my image.png')).toBe('images/my%20image.png')
  })
})

describe('relativeLinkTarget', () => {
  it('ignores links with a scheme', () => {
    expect(relativeLinkTarget('https://example.com')).toBeNull()
    expect(relativeLinkTarget('mailto:a@b.c')).toBeNull()
    expect(relativeLinkTarget('//cdn.example.com/x')).toBeNull()
  })

  it('splits path and fragment', () => {
    expect(relativeLinkTarget('docs/My%20Page.md#setup')).toEqual({ path: 'docs/My Page.md', fragment: 'setup' })
    expect(relativeLinkTarget('#intro')).toEqual({ path: '', fragment: 'intro' })
    expect(relativeLinkTarget('/README.md?plain=1')).toEqual({ path: '/README.md', fragment: '' })
  })
})
