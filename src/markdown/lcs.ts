/**
 * Longest common subsequence of two sequences, compared with `===`.
 * Returns the matched index pairs [i, j] in increasing order.
 *
 * Common prefixes and suffixes are matched first, so the quadratic table only
 * covers the changed middle. That keeps typical edits (a few blocks changed in
 * a long document) cheap.
 */
export function lcsPairs<T>(a: readonly T[], b: readonly T[]): Array<[number, number]> {
  const head: Array<[number, number]> = []
  const tail: Array<[number, number]> = []

  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) {
    head.push([lo, lo])
    lo++
  }
  let hiA = a.length
  let hiB = b.length
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--
    hiB--
    tail.push([hiA, hiB])
  }
  tail.reverse()

  const n = hiA - lo
  const m = hiB - lo
  if (n === 0 || m === 0) return head.concat(tail)

  // Guard against pathological sizes: past this, give up on matching the
  // middle (the caller treats unmatched blocks as edited, which is safe).
  if (n * m > 25_000_000) return head.concat(tail)

  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[lo + i] === b[lo + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const middle: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[lo + i] === b[lo + j]) {
      middle.push([lo + i, lo + j])
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return head.concat(middle, tail)
}
