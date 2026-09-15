import { quotePath, quotePaths } from '../src/shared/shellquote'

describe('quotePath', () => {
  it('leaves safe paths bare', () => {
    expect(quotePath('/Users/x/Desktop/shot.png')).toBe('/Users/x/Desktop/shot.png')
    expect(quotePath('~/a-b_c.1')).toBe('~/a-b_c.1')
  })
  it('single-quotes spaces and specials', () => {
    expect(quotePath('/Users/x/Screenshot 2026-09-15 at 1.02.03 PM.png')).toBe("'/Users/x/Screenshot 2026-09-15 at 1.02.03 PM.png'")
    expect(quotePath('a$b')).toBe("'a$b'")
  })
  it('escapes embedded single quotes', () => {
    expect(quotePath("it's.txt")).toBe("'it'\\''s.txt'")
  })
  it('quotePaths joins with a trailing space', () => {
    expect(quotePaths(['/a', '/b c'])).toBe("/a '/b c' ")
  })
})
