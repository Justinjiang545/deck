import { reconcile, CREATE_GRACE_MS } from '../src/main/poller'
import type { Terminal } from '../src/shared/state'

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
