import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects, projectPathFromCCDir } from '../src/main/projects'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deck-proj-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function ccProject(slug: string, cwd: string, mtimeSec: number): void {
  const d = join(dir, 'cc', slug)
  mkdirSync(d, { recursive: true })
  const f = join(d, 'session.jsonl')
  writeFileSync(f, JSON.stringify({ type: 'user', cwd, timestamp: 'x' }) + '\n' + JSON.stringify({ type: 'assistant', cwd }) + '\n')
  utimesSync(f, mtimeSec, mtimeSec)
}

describe('projectPathFromCCDir', () => {
  it('reads cwd from the first record', () => {
    const real = join(dir, 'repo'); mkdirSync(real)
    ccProject('-x-repo', real, 100)
    expect(projectPathFromCCDir(join(dir, 'cc', '-x-repo'))).toBe(real)
  })
  it('returns null when no jsonl', () => {
    mkdirSync(join(dir, 'cc', 'empty'), { recursive: true })
    expect(projectPathFromCCDir(join(dir, 'cc', 'empty'))).toBeNull()
  })
})

describe('listProjects', () => {
  it('orders recent → cc (newest first) → roots, dedupes, skips missing and hidden', () => {
    const roots = join(dir, 'roots'); mkdirSync(roots)
    for (const n of ['beta', 'alpha', '.hidden']) mkdirSync(join(roots, n))
    const old = join(dir, 'old'); mkdirSync(old)
    const fresh = join(dir, 'fresh'); mkdirSync(fresh)
    ccProject('-old', old, 100)
    ccProject('-fresh', fresh, 200)
    ccProject('-gone', join(dir, 'gone'), 300)
    ccProject('-alpha', join(roots, 'alpha'), 50)
    const res = listProjects({ ccProjectsDir: join(dir, 'cc'), roots: [roots], recent: [join(roots, 'beta'), join(dir, 'missing')] })
    expect(res.map((r) => [r.name, r.source])).toEqual([
      ['beta', 'recent'], ['fresh', 'cc'], ['old', 'cc'], ['alpha', 'cc']
    ])
  })
  it('tolerates a missing cc dir and missing roots', () => {
    expect(listProjects({ ccProjectsDir: join(dir, 'nope'), roots: [join(dir, 'nope2')], recent: [] })).toEqual([])
  })
})
