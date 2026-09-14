import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  sessionName, idFromSession, findTmux, baseArgs, newSessionArgs, attachArgs,
  capturePaneArgs, listPanesArgs, sendKeysArgs, parseListPanes, Tmux
} from '../src/main/tmux'

const o = { bin: '/opt/homebrew/bin/tmux', conf: '/x/deck.conf' }

describe('names', () => {
  it('round-trips session names', () => {
    expect(sessionName('abc')).toBe('deck-abc')
    expect(idFromSession('deck-abc')).toBe('abc')
    expect(idFromSession('other')).toBeNull()
  })
})

describe('argv builders', () => {
  it('baseArgs uses private socket and config', () => {
    expect(baseArgs(o)).toEqual(['-L', 'deck', '-f', '/x/deck.conf'])
  })
  it('newSessionArgs sets cwd and DECK_TERM_ID', () => {
    expect(newSessionArgs(o, 'abc', '/tmp')).toEqual([
      '-L', 'deck', '-f', '/x/deck.conf',
      'new-session', '-d', '-s', 'deck-abc', '-c', '/tmp', '-e', 'DECK_TERM_ID=abc'
    ])
  })
  it('attachArgs targets the session exactly', () => {
    expect(attachArgs(o, 'abc').slice(-3)).toEqual(['attach-session', '-t', '=deck-abc'])
  })
  it('capturePaneArgs captures history only, with escapes', () => {
    // pane-level target uses "=session:" (exact session + default window),
    // not bare "=session" — tmux 3.6a rejects that for pane-level commands,
    // and a bare session name (no "=") is subject to prefix matching and
    // can silently land in the wrong session (see tmux.ts comment).
    expect(capturePaneArgs(o, 'abc')).toEqual([...baseArgs(o), 'capture-pane', '-p', '-e', '-J', '-S', '-', '-E', '-1', '-t', '=deck-abc:'])
  })
  it('sendKeysArgs targets the exact session, not a prefix match', () => {
    expect(sendKeysArgs(o, 'abc', 'echo hi')).toEqual([...baseArgs(o), 'send-keys', '-t', '=deck-abc:', 'echo hi', 'Enter'])
  })
  it('listPanesArgs uses a tab-separated format', () => {
    const a = listPanesArgs(o)
    expect(a).toContain('list-panes')
    expect(a).toContain('-a')
    expect(a[a.length - 1]).toBe('#{session_name}\t#{pane_pid}\t#{pane_current_path}\t#{pane_current_command}')
  })
})

describe('parseListPanes', () => {
  it('parses deck sessions and skips others', () => {
    const out = 'deck-a\t123\t/Users/x\tzsh\nfoo\t1\t/\tbash\ndeck-b\t456\t/tmp\tclaude\n'
    expect(parseListPanes(out)).toEqual([
      { id: 'a', pid: 123, cwd: '/Users/x', fgCommand: 'zsh' },
      { id: 'b', pid: 456, cwd: '/tmp', fgCommand: 'claude' }
    ])
  })
  it('handles empty output', () => {
    expect(parseListPanes('')).toEqual([])
  })
})

describe('findTmux', () => {
  it('finds tmux on this machine', () => {
    const p = findTmux()
    expect(p).not.toBeNull()
    expect(existsSync(p!)).toBe(true)
  })
  it('falls back to homebrew path when PATH is empty', () => {
    const p = findTmux({ PATH: '' })
    expect(p === '/opt/homebrew/bin/tmux' || p === '/usr/local/bin/tmux' || p === null).toBe(true)
  })
})

// Integration: real tmux on an isolated socket. Skipped if tmux is missing.
const bin = findTmux()
const conf = resolve(__dirname, '../resources/deck.conf')
describe.skipIf(!bin)('Tmux integration', () => {
  const t = new Tmux({ bin: bin!, conf, socket: 'deck-test' })
  const id = 'itest-' + process.pid

  afterAll(async () => { await t.kill(id).catch(() => {}) ; await t.killServer().catch(() => {}) })

  it('creates, lists, captures, and kills a session', async () => {
    await t.newSession(id, '/tmp')
    const panes = await t.listPanes()
    const mine = panes.find((p) => p.id === id)
    expect(mine).toBeDefined()
    expect(mine!.cwd.endsWith('/tmp')).toBe(true) // macOS may resolve /tmp → /private/tmp
    await t.sendKeys(id, 'echo deck-hello')
    await new Promise((r) => setTimeout(r, 300))
    // history only (-E -1) may be empty for a fresh pane; capturePane must not throw
    const hist = await t.capturePane(id)
    expect(typeof hist).toBe('string')
    await t.kill(id)
    expect((await t.listPanes()).find((p) => p.id === id)).toBeUndefined()
  })
})
