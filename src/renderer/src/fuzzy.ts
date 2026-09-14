export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return 0
  let score = 0
  let ti = 0
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi]!, ti)
    if (idx === -1) return null
    score += idx === prev + 1 ? 3 : 1          // contiguous bonus
    if (idx === 0) score += 2                  // prefix bonus
    else if (/[-_ /.]/.test(t[idx - 1]!)) score += 1 // word-start bonus
    prev = idx
    ti = idx + 1
  }
  score -= (t.length - q.length) * 0.01        // slight preference for shorter texts
  return score
}

export function fuzzyFilter<T>(query: string, items: T[], key: (t: T) => string): T[] {
  if (!query) return items
  const scored: { item: T; score: number; i: number }[] = []
  items.forEach((item, i) => {
    const s = fuzzyScore(query, key(item))
    if (s !== null) scored.push({ item, score: s, i })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.map((s) => s.item)
}
