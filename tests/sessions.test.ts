import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCcSessions, parseSession } from '../src/main/sessions'

const j = (o: unknown): string => JSON.stringify(o) + '\n'

describe('parseSession', () => {
  it('takes cwd/branch/first prompt from the head and the latest ai-title + last-prompt from the tail', () => {
    const head =
      j({ type: 'user', isMeta: true, cwd: '/r', gitBranch: 'main', message: { content: 'meta stuff' } }) +
      j({ type: 'user', cwd: '/r', message: { content: '<command-name>/model</command-name>' } }) +
      j({ type: 'user', cwd: '/r', message: { content: [{ type: 'tool_result', content: 'x' }] } }) +
      j({ type: 'user', cwd: '/r', message: { content: 'fix the\n  login bug' } }) +
      j({ type: 'ai-title', aiTitle: 'Old title' })
    const tail = j({ type: 'ai-title', aiTitle: 'Login bug fix' }) + j({ type: 'last-prompt', lastPrompt: 'commit rn' })
    expect(parseSession('abc', head, tail, 5)).toEqual({ sessionId: 'abc', cwd: '/r', branch: 'main', title: 'Login bug fix', prompt: 'commit rn', lastActive: 5 })
  })

  it('falls back to the first real prompt and tolerates partial lines at chunk edges', () => {
    const head = j({ type: 'user', cwd: '/r', message: { content: [{ type: 'text', text: 'hello there' }] } }) + '{"type":"assis'
    expect(parseSession('a', head, 'tant"}\n', 1)).toEqual({ sessionId: 'a', cwd: '/r', prompt: 'hello there', lastActive: 1 })
  })

  it('returns null without a cwd', () => {
    expect(parseSession('a', j({ type: 'summary' }), '', 1)).toBeNull()
  })
})

describe('listCcSessions', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deck-sess-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function session(slug: string, id: string, cwd: string, mtime: number, extra = ''): void {
    mkdirSync(join(dir, slug), { recursive: true })
    const f = join(dir, slug, id + '.jsonl')
    writeFileSync(f, j({ type: 'user', cwd, message: { content: 'p-' + id } }) + extra)
    utimesSync(f, mtime, mtime)
  }

  it('lists sessions across projects newest first, honoring the limit', () => {
    session('-a', 's1', '/a', 100)
    session('-b', 's2', '/b', 300)
    session('-a', 's3', '/a', 200)
    writeFileSync(join(dir, '-a', 'notes.txt'), 'x')
    expect(listCcSessions(dir).map((s) => s.sessionId)).toEqual(['s2', 's3', 's1'])
    expect(listCcSessions(dir, 2).map((s) => s.sessionId)).toEqual(['s2', 's3'])
  })

  it('reads the title from the tail of a large file', () => {
    session('-a', 'big', '/a', 100, j({ type: 'assistant', pad: 'x'.repeat(400 * 1024) }) + j({ type: 'ai-title', aiTitle: 'Deep work' }))
    expect(listCcSessions(dir)[0]).toMatchObject({ sessionId: 'big', cwd: '/a', title: 'Deep work', prompt: 'p-big' })
  })

  it('returns [] for a missing dir', () => {
    expect(listCcSessions(join(dir, 'nope'))).toEqual([])
  })
})
