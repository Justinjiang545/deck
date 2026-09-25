import type { PaneInfo, Tmux } from './tmux'
import type { Action, Store } from './store'
import type { Terminal } from '../shared/state'
import { resolveForeground, snapshotProcs, type ProcInfo } from './procs'

export const CREATE_GRACE_MS = 3000
/** A pane must be absent from this many consecutive polls before its terminal is removed. */
export const REMOVE_AFTER_MISSES = 3
/** How long a removed terminal's title/folder are remembered so a quick re-adoption restores them. */
export const TOMBSTONE_MS = 5 * 60 * 1000

/** A terminal's foreground must miss `claude` this many consecutive polls before its stale `cc` is cleared. */
export const CC_CLEAR_AFTER_MISSES = 3

/** Cross-tick memory for reconcile: consecutive misses per id, and recently removed terminals. */
export interface ReconcileMemo {
  misses: Map<string, number>
  tombstones: Map<string, { terminal: Terminal; at: number }>
  ccMisses: Map<string, number>
}

export function newMemo(): ReconcileMemo {
  return { misses: new Map(), tombstones: new Map(), ccMisses: new Map() }
}

export function reconcile(terminals: Record<string, Terminal>, panes: PaneInfo[], now: number, memo: ReconcileMemo = newMemo(), removeAfter = REMOVE_AFTER_MISSES): Action[] {
  const actions: Action[] = []
  const seen = new Set<string>()
  for (const p of panes) {
    seen.add(p.id)
    memo.misses.delete(p.id)
    const t = terminals[p.id]
    if (!t) {
      const tomb = memo.tombstones.get(p.id)
      const restored = tomb && now - tomb.at < TOMBSTONE_MS ? tomb.terminal : undefined
      memo.tombstones.delete(p.id)
      actions.push({
        type: 'ADD_TERMINAL',
        terminal: {
          id: p.id, createdAt: restored?.createdAt ?? now, cwd: p.cwd, fgCommand: p.fgCommand, busy: p.busy ?? false, lastActivity: now, cc: null,
          ...(restored?.customTitle ? { customTitle: restored.customTitle } : {}),
          ...(restored?.folderId ? { folderId: restored.folderId } : {})
        }
      })
      continue
    }
    const patch: { cwd?: string; fgCommand?: string; busy?: boolean; lastActivity?: number } = {}
    if (t.cwd !== p.cwd) patch.cwd = p.cwd
    // tmux occasionally reports an empty command mid-transition; keep the last known value.
    if (p.fgCommand && t.fgCommand !== p.fgCommand) patch.fgCommand = p.fgCommand
    if ((t.busy ?? false) !== (p.busy ?? false)) patch.busy = p.busy ?? false
    if (Object.keys(patch).length) {
      patch.lastActivity = now
      actions.push({ type: 'UPDATE_TERMINAL', id: p.id, patch })
    }
    // CC status is hook-driven, but if the hooks were never installed (or CC was killed
    // without a SessionEnd hook firing) it must not linger forever: clear it once the pane's
    // foreground hasn't been `claude` for a few consecutive polls.
    if (t.cc) {
      if (p.fgCommand === 'claude') {
        memo.ccMisses.delete(p.id)
      } else {
        const misses = (memo.ccMisses.get(p.id) ?? 0) + 1
        if (misses >= CC_CLEAR_AFTER_MISSES) {
          memo.ccMisses.delete(p.id)
          actions.push({ type: 'SET_CC', id: p.id, cc: null })
        } else {
          memo.ccMisses.set(p.id, misses)
        }
      }
    } else {
      memo.ccMisses.delete(p.id)
    }
  }
  for (const t of Object.values(terminals)) {
    if (seen.has(t.id)) continue
    if (now - t.createdAt < CREATE_GRACE_MS) continue
    const misses = (memo.misses.get(t.id) ?? 0) + 1
    memo.misses.set(t.id, misses)
    if (misses < removeAfter) continue
    memo.misses.delete(t.id)
    memo.tombstones.set(t.id, { terminal: t, at: now })
    actions.push({ type: 'REMOVE_TERMINAL', id: t.id })
  }
  for (const [id, tomb] of memo.tombstones) if (now - tomb.at >= TOMBSTONE_MS) memo.tombstones.delete(id)
  return actions
}

/** Overlay the tty-foreground view (procs.ts) on tmux's pane list. */
export function withForeground(panes: PaneInfo[], procs: ProcInfo[]): PaneInfo[] {
  return panes.map((p) => ({ ...p, ...resolveForeground(p, procs) }))
}

export function startPoller(tmux: Tmux, store: Store, intervalMs = 1000, procs: () => Promise<ProcInfo[]> = snapshotProcs): () => void {
  let stopped = false
  let running = false
  const memo = newMemo()
  const tick = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      const before = store.state
      const [rawPanes, procList] = await Promise.all([tmux.listPanes(), procs()])
      if (stopped || store.state !== before) return // state moved under us; let the next tick reconcile
      const panes = withForeground(rawPanes, procList)
      if (process.env['DECK_DEBUG']) console.warn('[poller]', JSON.stringify(panes.map((p) => [p.id.slice(0, 8), p.fgCommand, p.busy])), 'procs', procList.length)
      for (const a of reconcile(store.state.terminals, panes, Date.now(), memo)) store.dispatch(a)
    } catch (err) {
      console.warn('[poller] tick failed:', err)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  void tick()
  return () => { stopped = true; clearInterval(timer) }
}
