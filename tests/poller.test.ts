import { reconcile, startPoller, CREATE_GRACE_MS } from '../src/main/poller'
import { Store } from '../src/main/store'
import { initialState } from '../src/shared/state'
import type { Terminal } from '../src/shared/state'
import type { PaneInfo, Tmux } from '../src/main/tmux'

function term(id: string, extra: Partial<Terminal> = {}): Terminal {
  return { id, createdAt: 0, cwd: '/a', fgCommand: 'zsh', lastActivity: 0, cc: null, ...extra }
}
const NOW = 100_000

describe('reconcile', () => {
  it('adopts unknown panes', () => {
    const acts = reconcile({}, [{ id: 'x', pid: 1, cwd: '/p', fgCommand: 'zsh' }], NOW)
    expect(acts).toEqual([{ type: 'ADD_TERMINAL', terminal: { id: 'x', createdAt: NOW, cwd: '/p', fgCommand: 'zsh', lastActivity: NOW, cc: null } }])
  })

  it('updates changed cwd/fgCommand only', () => {
    const acts = reconcile({ x: term('x') }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'vim' }], NOW)
    expect(acts).toEqual([{ type: 'UPDATE_TERMINAL', id: 'x', patch: { fgCommand: 'vim', lastActivity: NOW } }])
  })

  it('emits nothing when unchanged', () => {
    expect(reconcile({ x: term('x') }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW)).toEqual([])
  })

  it('removes terminals whose session is gone', () => {
    expect(reconcile({ x: term('x') }, [], NOW)).toEqual([{ type: 'REMOVE_TERMINAL', id: 'x' }])
  })

  it('keeps just-created terminals during the grace window', () => {
    const fresh = term('x', { createdAt: NOW - CREATE_GRACE_MS + 1 })
    expect(reconcile({ x: fresh }, [], NOW)).toEqual([])
    const old = term('y', { createdAt: NOW - CREATE_GRACE_MS })
    expect(reconcile({ y: old }, [], NOW)).toEqual([{ type: 'REMOVE_TERMINAL', id: 'y' }])
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function fakeTmux(listPanes: () => Promise<PaneInfo[]>): Tmux {
  return { listPanes } as unknown as Tmux
}

describe('startPoller', () => {
  it('does not resurrect a terminal killed while a listPanes() call is in flight', async () => {
    const home = '/home/deck'
    const store = new Store({ ...initialState(home), terminals: { x: term('x') } })

    const d = deferred<PaneInfo[]>()
    const tmux = fakeTmux(() => d.promise)

    const stop = startPoller(tmux, store, 1000)

    // Let the poller's initial tick reach and await listPanes() before we mutate the store.
    await Promise.resolve()
    await Promise.resolve()

    // Simulate killTerminal() winning the race: it removes 'x' from the store while the
    // stale list-panes call (still reporting 'x' present) is in flight.
    store.dispatch({ type: 'REMOVE_TERMINAL', id: 'x' })
    expect(store.state.terminals['x']).toBeUndefined()

    // Resolve the stale snapshot, which still lists the now-killed pane.
    d.resolve([{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }])
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The stale tick must be discarded rather than re-adopting 'x' as a new terminal.
    expect(store.state.terminals['x']).toBeUndefined()

    stop()
  })
})
