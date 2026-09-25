import { reconcile, startPoller, withForeground, newMemo, CREATE_GRACE_MS, REMOVE_AFTER_MISSES, TOMBSTONE_MS, CC_CLEAR_AFTER_MISSES } from '../src/main/poller'
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
    expect(acts).toEqual([{ type: 'ADD_TERMINAL', terminal: { id: 'x', createdAt: NOW, cwd: '/p', fgCommand: 'zsh', busy: false, lastActivity: NOW, cc: null } }])
  })

  it('updates changed cwd/fgCommand only', () => {
    const acts = reconcile({ x: term('x') }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'vim' }], NOW)
    expect(acts).toEqual([{ type: 'UPDATE_TERMINAL', id: 'x', patch: { fgCommand: 'vim', lastActivity: NOW } }])
  })

  it('emits nothing when unchanged', () => {
    expect(reconcile({ x: term('x') }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW)).toEqual([])
  })

  it('removes terminals whose session is gone (immediate mode, as used at boot)', () => {
    expect(reconcile({ x: term('x') }, [], NOW, newMemo(), 1)).toEqual([{ type: 'REMOVE_TERMINAL', id: 'x' }])
  })

  it('removes only after REMOVE_AFTER_MISSES consecutive misses, and a sighting resets the count', () => {
    const memo = newMemo()
    for (let i = 1; i < REMOVE_AFTER_MISSES; i++) expect(reconcile({ x: term('x') }, [], NOW, memo)).toEqual([])
    expect(reconcile({ x: term('x') }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)).toEqual([])
    for (let i = 1; i < REMOVE_AFTER_MISSES; i++) expect(reconcile({ x: term('x') }, [], NOW, memo)).toEqual([])
    expect(reconcile({ x: term('x') }, [], NOW, memo)).toEqual([{ type: 'REMOVE_TERMINAL', id: 'x' }])
  })

  it('restores title and folder when a removed terminal is re-adopted within TOMBSTONE_MS', () => {
    const memo = newMemo()
    const t = term('x', { customTitle: 'api', folderId: 'f1', createdAt: 5 })
    for (let i = 0; i < REMOVE_AFTER_MISSES; i++) reconcile({ x: t }, [], NOW, memo)
    const back = reconcile({}, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW + 1000, memo)
    expect(back).toEqual([{ type: 'ADD_TERMINAL', terminal: { id: 'x', createdAt: 5, cwd: '/a', fgCommand: 'zsh', busy: false, lastActivity: NOW + 1000, cc: null, customTitle: 'api', folderId: 'f1' } }])
    // tombstone consumed: a second adoption is fresh
    for (let i = 0; i < REMOVE_AFTER_MISSES; i++) reconcile({ x: t }, [], NOW, memo)
    const late = reconcile({}, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW + TOMBSTONE_MS, memo)
    expect(late[0]).toMatchObject({ type: 'ADD_TERMINAL', terminal: { id: 'x', createdAt: NOW + TOMBSTONE_MS } })
    expect((late[0] as { terminal: { customTitle?: string } }).terminal.customTitle).toBeUndefined()
  })

  it('ignores an empty fgCommand from tmux instead of clearing the last known one', () => {
    expect(reconcile({ x: term('x', { fgCommand: 'vim' }) }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: '' }], NOW)).toEqual([])
  })

  it('keeps just-created terminals during the grace window', () => {
    const fresh = term('x', { createdAt: NOW - CREATE_GRACE_MS + 1 })
    expect(reconcile({ x: fresh }, [], NOW)).toEqual([])
    const old = term('y', { createdAt: NOW - CREATE_GRACE_MS })
    expect(reconcile({ y: old }, [], NOW, newMemo(), 1)).toEqual([{ type: 'REMOVE_TERMINAL', id: 'y' }])
  })

  describe('stale cc clearing (hooks-driven cc must not linger if CC exits without a SessionEnd hook)', () => {
    it('clears cc after CC_CLEAR_AFTER_MISSES consecutive polls where fgCommand is not claude', () => {
      const memo = newMemo()
      const withCc = term('x', { fgCommand: 'claude', cc: { status: 'working' as const, unseen: false } })
      for (let i = 1; i < CC_CLEAR_AFTER_MISSES; i++) {
        expect(reconcile({ x: withCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)).not.toContainEqual({ type: 'SET_CC', id: 'x', cc: null })
      }
      const acts = reconcile({ x: withCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)
      expect(acts).toContainEqual({ type: 'SET_CC', id: 'x', cc: null })
    })

    it('a claude sighting resets the miss counter', () => {
      const memo = newMemo()
      const withCc = term('x', { fgCommand: 'claude', cc: { status: 'working' as const, unseen: false } })
      for (let i = 1; i < CC_CLEAR_AFTER_MISSES; i++) reconcile({ x: withCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)
      reconcile({ x: withCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'claude' }], NOW, memo)
      for (let i = 1; i < CC_CLEAR_AFTER_MISSES; i++) {
        const acts = reconcile({ x: withCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)
        expect(acts).not.toContainEqual({ type: 'SET_CC', id: 'x', cc: null })
      }
    })

    it('never touches cc for a terminal that has none', () => {
      const memo = newMemo()
      const noCc = term('x', { fgCommand: 'zsh' })
      for (let i = 0; i < CC_CLEAR_AFTER_MISSES + 2; i++) {
        expect(reconcile({ x: noCc }, [{ id: 'x', pid: 1, cwd: '/a', fgCommand: 'zsh' }], NOW, memo)).toEqual([])
      }
    })
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

describe('withForeground', () => {
  it('overlays busy/fgCommand from the process snapshot and adopts busy into ADD/UPDATE', () => {
    const procs = [
      { pid: 10, pgid: 10, tpgid: 20, comm: '-zsh' },
      { pid: 20, pgid: 20, tpgid: 20, comm: 'bash' },
      { pid: 21, pgid: 20, tpgid: 20, comm: 'claude' },
      { pid: 30, pgid: 30, tpgid: 30, comm: '-zsh' }
    ]
    const panes = withForeground(
      [{ id: 'a', pid: 10, cwd: '/a', fgCommand: 'bash' }, { id: 'b', pid: 30, cwd: '/b', fgCommand: 'zsh' }],
      procs
    )
    expect(panes).toEqual([
      { id: 'a', pid: 10, cwd: '/a', fgCommand: 'claude', busy: true },
      { id: 'b', pid: 30, cwd: '/b', fgCommand: 'zsh', busy: false }
    ])
    const acts = reconcile({ b: term('b', { cwd: '/b' }) }, panes, NOW)
    expect(acts[0]).toMatchObject({ type: 'ADD_TERMINAL', terminal: { id: 'a', fgCommand: 'claude', busy: true } })
    expect(acts.length).toBe(1) // b unchanged: busy false == absent
    const acts2 = reconcile({ b: term('b', { cwd: '/b', busy: true }) }, panes.filter((p) => p.id === 'b'), NOW)
    expect(acts2).toEqual([{ type: 'UPDATE_TERMINAL', id: 'b', patch: { busy: false, lastActivity: NOW } }])
  })
})

describe('startPoller', () => {
  it('does not resurrect a terminal killed while a listPanes() call is in flight', async () => {
    const home = '/home/deck'
    const store = new Store({ ...initialState(home), terminals: { x: term('x') } })

    const d = deferred<PaneInfo[]>()
    const tmux = fakeTmux(() => d.promise)

    const stop = startPoller(tmux, store, 1000, async () => [])

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
