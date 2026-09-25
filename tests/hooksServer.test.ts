import { createConnection } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { initialState, type Terminal } from '../src/shared/state'
import { startHooksServer, type HooksServerHandle } from '../src/main/hooksServer'

function term(id: string, extra: Partial<Terminal> = {}): Terminal {
  return { id, createdAt: 0, cwd: '/a', fgCommand: 'zsh', lastActivity: 0, cc: null, ...extra }
}

function sockPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'deck-hooksrv-')), 'hooks.sock')
}

function send(path: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path, () => {
      sock.write(line.endsWith('\n') ? line : line + '\n', () => { sock.end(); resolve() })
    })
    sock.on('error', reject)
  })
}

// small helper: poll until a predicate is true or timeout
function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (pred()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for condition'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('startHooksServer', () => {
  let handle: HooksServerHandle | null = null
  afterEach(() => { handle?.close(); handle = null })

  it('maps a Stop event line to SET_CC on the matching terminal, unseen when not visible', async () => {
    const store = new Store({ ...initialState('/home/u'), terminals: { a: term('a') } })
    const socketPath = sockPath()
    handle = startHooksServer({ store, socketPath, isVisible: () => false })

    await send(socketPath, JSON.stringify({ term: 'a', event: 'Stop', payload: { last_assistant_message: 'all done' } }))
    await waitFor(() => store.state.terminals['a']?.cc?.status === 'needs-you')

    expect(store.state.terminals['a']?.cc).toMatchObject({ status: 'needs-you', attention: 'done', unseen: true, lastMessage: 'all done' })
  })

  it('does not mark unseen when the terminal is the visible/focused pane', async () => {
    const store = new Store({ ...initialState('/home/u'), terminals: { a: term('a') } })
    const socketPath = sockPath()
    handle = startHooksServer({ store, socketPath, isVisible: (id) => id === 'a' })

    await send(socketPath, JSON.stringify({ term: 'a', event: 'Notification', payload: {} }))
    await waitFor(() => store.state.terminals['a']?.cc?.status === 'needs-you')

    expect(store.state.terminals['a']?.cc).toMatchObject({ status: 'needs-you', attention: 'input', unseen: false })
  })

  it('calls onAttention only when the resulting cc is unseen', async () => {
    const store = new Store({ ...initialState('/home/u'), terminals: { a: term('a'), b: term('b') } })
    const socketPath = sockPath()
    const seen: string[] = []
    handle = startHooksServer({ store, socketPath, isVisible: (id) => id === 'b', onAttention: (id) => seen.push(id) })

    await send(socketPath, JSON.stringify({ term: 'a', event: 'Stop', payload: {} })) // not visible -> attention
    await send(socketPath, JSON.stringify({ term: 'b', event: 'Stop', payload: {} })) // visible -> no attention
    await waitFor(() => store.state.terminals['a']?.cc?.status === 'needs-you' && store.state.terminals['b']?.cc?.status === 'needs-you')

    expect(seen).toEqual(['a'])
  })

  it('ignores an unknown terminal id and malformed/unknown-event lines without throwing', async () => {
    const store = new Store({ ...initialState('/home/u'), terminals: { a: term('a') } })
    const socketPath = sockPath()
    handle = startHooksServer({ store, socketPath, isVisible: () => false })

    await send(socketPath, JSON.stringify({ term: 'ghost', event: 'Stop', payload: {} }))
    await send(socketPath, 'not json at all')
    await send(socketPath, JSON.stringify({ term: 'a', event: 'PreToolUse', payload: {} })) // not a deck-tracked event
    await new Promise((r) => setTimeout(r, 100))

    expect(store.state.terminals['a']?.cc).toBeNull()
    expect(store.state.terminals['ghost']).toBeUndefined()
  })

  it('handles multiple events in one write (line-delimited)', async () => {
    const store = new Store({ ...initialState('/home/u'), terminals: { a: term('a') } })
    const socketPath = sockPath()
    handle = startHooksServer({ store, socketPath, isVisible: () => false })
    const lines =
      JSON.stringify({ term: 'a', event: 'SessionStart', payload: { session_id: 's1' } }) + '\n' +
      JSON.stringify({ term: 'a', event: 'UserPromptSubmit', payload: {} }) + '\n'
    await send(socketPath, lines)
    await waitFor(() => store.state.terminals['a']?.cc?.status === 'working')
    expect(store.state.terminals['a']?.cc).toEqual({ sessionId: 's1', status: 'working', unseen: false, lastMessage: undefined })
  })
})
