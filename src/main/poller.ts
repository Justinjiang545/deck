import type { PaneInfo, Tmux } from './tmux'
import type { Action, Store } from './store'
import type { Terminal } from '../shared/state'
import { resolveForeground, snapshotProcs, type ProcInfo } from './procs'

export const CREATE_GRACE_MS = 3000

export function reconcile(terminals: Record<string, Terminal>, panes: PaneInfo[], now: number): Action[] {
  const actions: Action[] = []
  const seen = new Set<string>()
  for (const p of panes) {
    seen.add(p.id)
    const t = terminals[p.id]
    if (!t) {
      actions.push({ type: 'ADD_TERMINAL', terminal: { id: p.id, createdAt: now, cwd: p.cwd, fgCommand: p.fgCommand, busy: p.busy ?? false, lastActivity: now, cc: null } })
      continue
    }
    const patch: { cwd?: string; fgCommand?: string; busy?: boolean; lastActivity?: number } = {}
    if (t.cwd !== p.cwd) patch.cwd = p.cwd
    if (t.fgCommand !== p.fgCommand) patch.fgCommand = p.fgCommand
    if ((t.busy ?? false) !== (p.busy ?? false)) patch.busy = p.busy ?? false
    if (Object.keys(patch).length) {
      patch.lastActivity = now
      actions.push({ type: 'UPDATE_TERMINAL', id: p.id, patch })
    }
  }
  for (const t of Object.values(terminals)) {
    if (seen.has(t.id)) continue
    if (now - t.createdAt < CREATE_GRACE_MS) continue
    actions.push({ type: 'REMOVE_TERMINAL', id: t.id })
  }
  return actions
}

/** Overlay the tty-foreground view (procs.ts) on tmux's pane list. */
export function withForeground(panes: PaneInfo[], procs: ProcInfo[]): PaneInfo[] {
  return panes.map((p) => ({ ...p, ...resolveForeground(p, procs) }))
}

export function startPoller(tmux: Tmux, store: Store, intervalMs = 1000, procs: () => Promise<ProcInfo[]> = snapshotProcs): () => void {
  let stopped = false
  let running = false
  const tick = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      const before = store.state
      const [rawPanes, procList] = await Promise.all([tmux.listPanes(), procs()])
      if (stopped || store.state !== before) return // state moved under us; let the next tick reconcile
      const panes = withForeground(rawPanes, procList)
      for (const a of reconcile(store.state.terminals, panes, Date.now())) store.dispatch(a)
    } catch {
      /* transient tmux error: skip this tick */
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  void tick()
  return () => { stopped = true; clearInterval(timer) }
}
