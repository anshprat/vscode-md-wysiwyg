import { type Block, splitBlocks } from './blocks'
import { lcsPairs } from './lcs'

/**
 * A piece of the merged output: either an original block copied verbatim
 * (`o` = index into the original blocks) or new text from the editor
 * (`e1` = index into the edited blocks).
 */
type Piece = { o: number } | { e1: number }

interface FuzzyGap {
  /** Original (non-definition) block indices in this gap. */
  o: number[]
  /** Base (editor-at-load) block indices in this gap. */
  e: number[]
}

/**
 * Merges the WYSIWYG editor's output back into the original Markdown so that
 * blocks the user did not touch keep their exact original source.
 *
 * - `original`: the file content the editor was loaded with.
 * - `base`: what the editor serialized right after loading `original`.
 * - `edited`: what the editor serializes now.
 *
 * Every WYSIWYG editor normalizes Markdown (list markers, emphasis markers,
 * escaping, table padding, reference links...). Without this merge, a one-word
 * edit would rewrite the whole file and produce a noisy commit diff.
 *
 * Approach: align `base` blocks to `original` blocks by content (type + plain
 * text), diff `base` against `edited` exactly, then emit the original source
 * for every block that is unchanged and the editor's text for the rest.
 * Original blocks the editor cannot represent (link reference definitions,
 * anything it dropped) are kept in place.
 */
export function mergePreserving(original: string, base: string, edited: string): string {
  if (edited === base) return original
  if (original.trim() === '') return edited

  const O = splitBlocks(original)
  const E0 = splitBlocks(base)
  const E1 = splitBlocks(edited)
  if (O.length === 0) return edited

  // 1. Align base blocks with original content blocks.
  const content = O.map((b, i) => i).filter((i) => O[i].type !== 'definition')
  const anchors = lcsPairs(
    content.map((i) => O[i].key),
    E0.map((b) => b.key),
  )

  const oOfE0 = new Array<number>(E0.length).fill(-1)
  const gapOfE0 = new Array<number>(E0.length).fill(-1)
  const gaps: FuzzyGap[] = []

  let prevC = 0
  let prevE = 0
  for (const [ci, ej] of [...anchors, [content.length, E0.length] as [number, number]]) {
    const gapO = content.slice(prevC, ci)
    const gapE = range(prevE, ej)
    if (gapO.length === gapE.length) {
      // Same shape: the editor changed the text of these blocks while
      // round-tripping (escaping, whitespace). Pair them by position.
      gapE.forEach((j, n) => (oOfE0[j] = gapO[n]))
    } else if (gapO.length > 0 || gapE.length > 0) {
      const id = gaps.length
      gaps.push({ o: gapO, e: gapE })
      gapE.forEach((j) => (gapOfE0[j] = id))
    }
    if (ci < content.length) oOfE0[ej] = content[ci]
    prevC = ci + 1
    prevE = ej + 1
  }

  // 2. Find which base blocks the user left unchanged.
  const unchanged = lcsPairs(
    E0.map((b) => b.text),
    E1.map((b) => b.text),
  )
  const e1OfE0 = new Array<number>(E0.length).fill(-1)
  const e0OfE1 = new Array<number>(E1.length).fill(-1)
  for (const [j, k] of unchanged) {
    e1OfE0[j] = k
    e0OfE1[k] = j
  }

  // A fuzzy gap is intact when all of its base blocks survive unchanged and
  // stay contiguous. Then its original text can be reused as a whole.
  const intact = gaps.map((g) =>
    g.e.every((j, n) => e1OfE0[j] >= 0 && (n === 0 || e1OfE0[j] === e1OfE0[g.e[n - 1]] + 1)),
  )

  // Original position of each base block (fuzzy-gap blocks use the gap's end).
  const posOfE0 = E0.map((b, j) => {
    if (oOfE0[j] >= 0) return oOfE0[j]
    const g = gaps[gapOfE0[j]]
    return g && g.o.length > 0 ? g.o[g.o.length - 1] : NaN
  })
  // New or edited blocks take the original position of the base blocks they
  // replaced, so kept blocks (see step 4) land on the right side of them.
  const posOfE1 = new Array<number>(E1.length).fill(NaN)
  let pj = 0
  let pk = 0
  for (const [j, k] of [...unchanged, [E0.length, E1.length] as [number, number]]) {
    const replaced = range(pj, j)
      .map((x) => posOfE0[x])
      .filter((x) => !Number.isNaN(x))
    if (replaced.length > 0) range(pk, k).forEach((x) => (posOfE1[x] = Math.max(...replaced)))
    pj = j + 1
    pk = k + 1
  }

  // 3. Build the output pieces in edited order, each with its original position.
  const pieces: Piece[] = []
  const pos: number[] = []
  const emitted = new Set<number>()
  const pushOriginal = (o: number) => {
    pieces.push({ o })
    pos.push(o)
    emitted.add(o)
  }
  const pushEdited = (k: number) => {
    pieces.push({ e1: k })
    const prev = pos.length > 0 ? pos[pos.length - 1] : -1
    // Without a replaced block, sit just after the previous piece (but before
    // the next original position).
    const after = (prev + Math.floor(prev) + 1) / 2
    pos.push(Number.isNaN(posOfE1[k]) ? after : Math.max(posOfE1[k], prev))
  }
  for (let k = 0; k < E1.length; k++) {
    const j = e0OfE1[k]
    if (j < 0) {
      pushEdited(k)
    } else if (oOfE0[j] >= 0) {
      pushOriginal(oOfE0[j])
    } else {
      const g = gapOfE0[j]
      if (g >= 0 && intact[g]) {
        if (j === gaps[g].e[0]) gaps[g].o.forEach(pushOriginal)
      } else {
        pushEdited(k)
      }
    }
  }

  // 4. Keep original blocks the editor never saw: link reference definitions
  // and blocks it dropped (gaps with no base blocks at all).
  const sticky = new Set<number>()
  O.forEach((b, i) => b.type === 'definition' && sticky.add(i))
  gaps.forEach((g) => g.e.length === 0 && g.o.forEach((i) => sticky.add(i)))
  for (const s of [...sticky].sort((a, b) => a - b)) {
    if (emitted.has(s)) continue
    const at = findLastIndex(pos, (p) => p < s)
    pieces.splice(at + 1, 0, { o: s })
    pos.splice(at + 1, 0, s)
    emitted.add(s)
  }

  // 5. Join, reusing original/edited separators where blocks were adjacent.
  return join(pieces, original, O, edited, E1)
}

function join(pieces: Piece[], original: string, O: Block[], edited: string, E1: Block[]): string {
  if (pieces.length === 0) return ''
  let out = ''
  const first = pieces[0]
  if ('o' in first && first.o === 0) out += original.slice(0, O[0].start)
  for (let n = 0; n < pieces.length; n++) {
    const p = pieces[n]
    if (n > 0) {
      const q = pieces[n - 1]
      if ('o' in q && 'o' in p && p.o === q.o + 1) out += original.slice(O[q.o].end, O[p.o].start)
      else if ('e1' in q && 'e1' in p && p.e1 === q.e1 + 1) out += edited.slice(E1[q.e1].end, E1[p.e1].start)
      else out += '\n\n'
    }
    out += 'o' in p ? O[p.o].text : E1[p.e1].text
  }
  const last = pieces[pieces.length - 1]
  if ('o' in last && last.o === O.length - 1) out += original.slice(O[last.o].end)
  else if (original.endsWith('\n')) out += '\n'
  return out
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i < to; i++) out.push(i)
  return out
}

function findLastIndex<T>(arr: T[], fn: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i
  return -1
}
