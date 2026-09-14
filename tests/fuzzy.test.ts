import { fuzzyScore, fuzzyFilter } from '../src/renderer/src/fuzzy'

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyScore('rl', 'Roll')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Roll')).toBeNull()
    expect(fuzzyScore('', 'Roll')).toBe(0)
  })
  it('prefers prefix and contiguous matches', () => {
    const a = fuzzyScore('roll', 'Roll')!
    const b = fuzzyScore('roll', 'rollpoker-web')!
    const c = fuzzyScore('roll', 'r-o-l-l')!
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })
})

describe('fuzzyFilter', () => {
  it('filters and sorts, keeps input order on empty query', () => {
    const items = ['valorant-model', 'Roll', 'rollpoker-web', 'capper-monitor']
    expect(fuzzyFilter('', items, (s) => s)).toEqual(items)
    expect(fuzzyFilter('roll', items, (s) => s)).toEqual(['Roll', 'rollpoker-web'])
    expect(fuzzyFilter('cm', items, (s) => s)).toEqual(['capper-monitor'])
  })
})
