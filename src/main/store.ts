import type { AppState, Folder, Layout, Terminal, ThemeName } from '../shared/state'
import {
  buildGrid,
  countLeaves,
  leaves,
  MAX_PANES,
  rebalanceChain,
  removeLeaf,
  replaceLeaf,
  setRatio,
  splitLeaf,
  swapLeaves,
  type Dir,
  type PathStep,
  type Side
} from '../shared/layout'

export type Action =
  | { type: 'HYDRATE'; state: AppState }
  | { type: 'ADD_TERMINAL'; terminal: Terminal }
  | { type: 'REMOVE_TERMINAL'; id: string }
  | { type: 'UPDATE_TERMINAL'; id: string; patch: Partial<Pick<Terminal, 'cwd' | 'fgCommand' | 'busy' | 'lastActivity'>> }
  | { type: 'RENAME_TERMINAL'; id: string; title: string | null }
  | { type: 'SHOW_TERMINAL'; id: string }
  | { type: 'CLOSE_PANE'; id: string }
  | { type: 'SET_SIDEBAR'; open: boolean }
  | { type: 'TOUCH_PROJECT'; path: string }
  | { type: 'ADD_FOLDER'; folder: Folder }
  | { type: 'RENAME_FOLDER'; id: string; name: string }
  | { type: 'DELETE_FOLDER'; id: string }
  | { type: 'SET_FOLDER_COLLAPSED'; id: string; collapsed: boolean }
  | { type: 'REORDER_FOLDERS'; ids: string[] }
  | { type: 'MOVE_TERMINAL'; id: string; folderId: string | null }
  | { type: 'SELECT_FOLDER'; id: string | null }
  | { type: 'REORDER_TABS'; ids: string[] }
  | { type: 'ACTIVATE_TAB'; id: string }
  | { type: 'SPLIT_PANE'; tabId: string; leafId: string; dir: Dir; newTerminalId: string; side?: Side }
  | { type: 'CLOSE_LEAF'; tabId: string; terminalId: string }
  | { type: 'SET_RATIO'; tabId: string; path: PathStep[]; ratio: number }
  | { type: 'FOCUS_PANE'; tabId: string; terminalId: string }
  | { type: 'TILE_TABS' }
  | {
      type: 'MOVE_PANE'
      terminalId: string
      toTabId: string
      targetLeafId: string
      zone: 'left' | 'right' | 'top' | 'bottom' | 'center'
    }
  | { type: 'SET_CC'; id: string; cc: Terminal['cc'] }
  | { type: 'SET_THEME'; theme: ThemeName }

const MAX_RECENT = 20

/**
 * Switch the active tab. Remembers the outgoing tab's focused pane in `tabFocus` and restores
 * (or picks) the incoming tab's focus. `focusOverride`, when given, wins over any remembered
 * focus — used when an action is itself about a specific pane (e.g. clicking a sidebar row).
 */
function acknowledged(cc: NonNullable<Terminal['cc']>): NonNullable<Terminal['cc']> {
  return { ...cc, unseen: false, attention: undefined, status: cc.status === 'needs-you' ? 'idle' : cc.status }
}

function withActive(state: AppState, activeTabId: string | null, focusOverride?: string): AppState {
  const prevActive = state.activeTabId
  // Only stash the outgoing tab's focus when we're actually leaving it — if activeTabId is
  // unchanged (a same-tab focus refresh, e.g. after a split/move), state.focusedTerminalId is
  // about to be superseded below and isn't the "last focus" we want remembered for later.
  let tabFocus =
    prevActive && prevActive !== activeTabId && state.focusedTerminalId
      ? { ...state.tabFocus, [prevActive]: state.focusedTerminalId }
      : state.tabFocus
  let focusedTerminalId: string | null = null
  if (activeTabId) {
    const layout = state.layouts[activeTabId] ?? null
    const ls = leaves(layout)
    const remembered = focusOverride ?? tabFocus[activeTabId]
    focusedTerminalId = (remembered && ls.includes(remembered) ? remembered : ls[0]) ?? null
    if (focusedTerminalId) tabFocus = { ...tabFocus, [activeTabId]: focusedTerminalId }
  }
  // Focusing a terminal (any path: tab switch, pane click, sidebar row) acknowledges its
  // Claude "done"/"needs input" attention flag.
  let terminals = state.terminals
  const ft = focusedTerminalId ? terminals[focusedTerminalId] : undefined
  if (ft?.cc?.unseen) terminals = { ...terminals, [ft.id]: { ...ft, cc: acknowledged(ft.cc) } }
  return {
    ...state,
    terminals,
    activeTabId,
    tabFocus,
    layout: activeTabId ? (state.layouts[activeTabId] ?? null) : null,
    focusedTerminalId
  }
}

function closeTab(state: AppState, id: string): AppState {
  const i = state.openTabs.indexOf(id)
  if (i === -1) return state
  const openTabs = state.openTabs.filter((t) => t !== id)
  const layouts = { ...state.layouts }
  delete layouts[id]
  const tabFocus = { ...state.tabFocus }
  delete tabFocus[id]
  let active = state.activeTabId
  if (active === id) active = openTabs[i] ?? openTabs[i - 1] ?? null
  return withActive({ ...state, openTabs, layouts, tabFocus }, active)
}

/** The tab whose layout currently contains this terminal as a leaf, if any. */
function findTabForTerminal(state: AppState, terminalId: string): string | null {
  for (const tabId of state.openTabs) {
    const l = state.layouts[tabId]
    if (l && leaves(l).includes(terminalId)) return tabId
  }
  return null
}

/** Remove one leaf from a tab's layout, closing the tab entirely if that was its last pane. */
/**
 * A leaf that will share the closed pane's row/column after removal: its sibling if that's a
 * leaf, else a direct leaf child of a same-direction sibling split. Null when the sibling is a
 * differently-directed split, so user-tuned ratios elsewhere are left alone.
 */
function chainNeighbour(l: Layout, id: string): string | null {
  if (l.type === 'leaf') return null
  const pick = (sib: Layout): string | null => {
    if (sib.type === 'leaf') return sib.terminalId
    if (sib.dir !== l.dir) return null
    if (sib.a.type === 'leaf') return sib.a.terminalId
    if (sib.b.type === 'leaf') return sib.b.terminalId
    return null
  }
  if (l.a.type === 'leaf' && l.a.terminalId === id) return pick(l.b)
  if (l.b.type === 'leaf' && l.b.terminalId === id) return pick(l.a)
  return chainNeighbour(l.a, id) ?? chainNeighbour(l.b, id)
}

function removeFromTab(state: AppState, tabId: string, terminalId: string): AppState {
  const l = state.layouts[tabId]
  if (!l || !leaves(l).includes(terminalId)) return state
  const removed = removeLeaf(l, terminalId)
  if (!removed) return closeTab(state, tabId)
  // Give the freed space back evenly to the row/column the pane sat in.
  const neighbour = chainNeighbour(l, terminalId)
  const newLayout = (neighbour ? rebalanceChain(removed, neighbour) : removed) ?? removed
  const layouts = { ...state.layouts, [tabId]: newLayout }
  const tabFocus = { ...state.tabFocus }
  if (tabFocus[tabId] === terminalId) delete tabFocus[tabId]
  const next = { ...state, layouts, tabFocus }
  return tabId === state.activeTabId ? withActive(next, tabId) : next
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state

    case 'ADD_TERMINAL':
      return { ...state, terminals: { ...state.terminals, [action.terminal.id]: action.terminal } }

    case 'REMOVE_TERMINAL': {
      if (!state.terminals[action.id]) return state
      const terminals = { ...state.terminals }
      delete terminals[action.id]
      let next: AppState = { ...state, terminals }
      // Drop this terminal's leaf out of every tab that has it open — not just its own tab
      // (a split can carry a terminal into a tab it wasn't opened in).
      for (const tabId of next.openTabs) {
        if (leaves(next.layouts[tabId] ?? null).includes(action.id)) next = removeFromTab(next, tabId, action.id)
      }
      return next
    }

    case 'UPDATE_TERMINAL': {
      const t = state.terminals[action.id]
      if (!t) return state
      const changed = (Object.keys(action.patch) as (keyof typeof action.patch)[]).some(
        (k) => action.patch[k] !== undefined && action.patch[k] !== t[k]
      )
      if (!changed) return state
      return { ...state, terminals: { ...state.terminals, [action.id]: { ...t, ...action.patch } } }
    }

    case 'RENAME_TERMINAL': {
      const t = state.terminals[action.id]
      if (!t) return state
      const next: Terminal = { ...t }
      if (action.title && action.title.trim()) next.customTitle = action.title.trim()
      else delete next.customTitle
      return { ...state, terminals: { ...state.terminals, [action.id]: next } }
    }

    case 'SHOW_TERMINAL': {
      const t = state.terminals[action.id]
      if (!t) return state
      const folderId = t.folderId ?? null
      const owningTab = findTabForTerminal(state, action.id)
      if (owningTab) {
        if (state.activeTabId === owningTab && state.focusedTerminalId === action.id && state.selectedFolderId === folderId && !t.cc?.unseen) {
          return state
        }
        return withActive({ ...state, selectedFolderId: folderId }, owningTab, action.id)
      }
      // Not open anywhere (including as an anchor with a stale/absent layout): open it as a
      // fresh single-pane tab.
      if (
        state.activeTabId === action.id &&
        state.openTabs.includes(action.id) &&
        state.selectedFolderId === folderId &&
        state.focusedTerminalId === action.id &&
        !t.cc?.unseen
      ) {
        return state
      }
      const openTabs = state.openTabs.includes(action.id) ? state.openTabs : [...state.openTabs, action.id]
      const layouts = state.layouts[action.id] ? state.layouts : { ...state.layouts, [action.id]: { type: 'leaf', terminalId: action.id } as Layout }
      return withActive({ ...state, openTabs, layouts, selectedFolderId: folderId }, action.id, action.id)
    }

    case 'SET_CC': {
      const t = state.terminals[action.id]
      if (!t) return state
      return { ...state, terminals: { ...state.terminals, [action.id]: { ...t, cc: action.cc } } }
    }

    case 'CLOSE_PANE':
      return closeTab(state, action.id)

    case 'ACTIVATE_TAB': {
      if (!state.openTabs.includes(action.id) || state.activeTabId === action.id) return state
      return withActive(state, action.id)
    }

    case 'SPLIT_PANE': {
      if (!state.terminals[action.newTerminalId]) return state
      const l = state.layouts[action.tabId]
      if (!l || !leaves(l).includes(action.leafId)) return state
      if (countLeaves(l) >= 9) return state
      const split = splitLeaf(l, action.leafId, action.dir, action.newTerminalId, action.side ?? 'after')
      if (split === l) return state
      // Rebalance the whole same-direction chain the new pane just joined, so repeated splits
      // (e.g. ⌘D on the rightmost pane again and again) land on an even n-way split instead of
      // halving the remaining space every time and leaving slivers.
      const updated = rebalanceChain(split, action.newTerminalId)
      const layouts = { ...state.layouts, [action.tabId]: updated! }
      const next = { ...state, layouts }
      return action.tabId === next.activeTabId ? withActive(next, action.tabId, action.newTerminalId) : next
    }

    case 'CLOSE_LEAF':
      if (!state.layouts[action.tabId]) return state
      return removeFromTab(state, action.tabId, action.terminalId)

    case 'SET_RATIO': {
      const l = state.layouts[action.tabId]
      if (!l) return state
      const updated = setRatio(l, action.path, action.ratio)
      if (updated === l) return state
      const layouts = { ...state.layouts, [action.tabId]: updated! }
      const next = { ...state, layouts }
      return action.tabId === next.activeTabId ? { ...next, layout: updated } : next
    }

    case 'FOCUS_PANE': {
      if (action.tabId !== state.activeTabId) return state
      const l = state.layouts[action.tabId]
      if (!l || !leaves(l).includes(action.terminalId) || (state.focusedTerminalId === action.terminalId && !state.terminals[action.terminalId]?.cc?.unseen)) return state
      return withActive(state, action.tabId, action.terminalId)
    }

    case 'TILE_TABS': {
      // Gathers one terminal per open tab — its currently-focused pane if it has one, else its
      // first leaf — into the active tab's layout as a balanced grid. Tabs beyond MAX_PANES are
      // left open and untouched; tabs fully absorbed (their only pane taken) close, same as any
      // other pane move. The active tab itself is never "moved from" — its layout is replaced
      // directly with the grid once everything else has been gathered in.
      const targetTabId = state.activeTabId
      if (!targetTabId) return state
      const ids: string[] = []
      for (const tabId of state.openTabs) {
        if (ids.length >= MAX_PANES) break
        const ls = leaves(state.layouts[tabId] ?? null)
        if (ls.length === 0) continue
        const remembered = tabId === state.activeTabId ? state.focusedTerminalId : state.tabFocus[tabId]
        const id = (remembered && ls.includes(remembered) ? remembered : ls[0])!
        if (!ids.includes(id)) ids.push(id)
      }
      if (ids.length < 2) return state
      const grid = buildGrid(ids)
      if (!grid) return state

      let working = state
      for (const id of ids) {
        const owner = findTabForTerminal(working, id)
        if (owner && owner !== targetTabId) working = removeFromTab(working, owner, id)
      }
      const layouts = { ...working.layouts, [targetTabId]: grid }
      const tabFocus = { ...working.tabFocus, [targetTabId]: ids[0]! }
      const openTabs = working.openTabs.includes(targetTabId) ? working.openTabs : [...working.openTabs, targetTabId]
      const next = { ...working, layouts, tabFocus, openTabs }
      return withActive(next, targetTabId, ids[0])
    }

    case 'MOVE_PANE': {
      const { terminalId, toTabId, targetLeafId, zone } = action
      if (!state.terminals[terminalId] || terminalId === targetLeafId) return state
      const sourceTabId = findTabForTerminal(state, terminalId)

      if (zone === 'center') {
        const destLayout = state.layouts[toTabId]
        if (!destLayout || !leaves(destLayout).includes(targetLeafId)) return state
        const displacedId = targetLeafId // the terminal currently occupying that leaf

        // Both panes live in the same tree: swap in place, no tab bookkeeping needed.
        if (sourceTabId === toTabId) {
          const updated = swapLeaves(destLayout, terminalId, displacedId)
          if (updated === destLayout) return state
          const layouts = { ...state.layouts, [toTabId]: updated! }
          const tabFocus = { ...state.tabFocus, [toTabId]: terminalId }
          const next = { ...state, layouts, tabFocus }
          return toTabId === next.activeTabId ? withActive(next, toTabId, terminalId) : next
        }

        // Cross-tab: X takes Y's spot in the destination; Y takes X's old spot — either back
        // into X's own tree (if X came from one) or, if that tree was just X alone, the whole
        // tab is handed to Y so it keeps existing rather than closing.
        const layouts = { ...state.layouts, [toTabId]: replaceLeaf(destLayout, targetLeafId, terminalId)! }
        const tabFocus = { ...state.tabFocus, [toTabId]: terminalId }
        if (sourceTabId) {
          const sourceLayout = state.layouts[sourceTabId]!
          layouts[sourceTabId] =
            countLeaves(sourceLayout) === 1
              ? { type: 'leaf', terminalId: displacedId }
              : replaceLeaf(sourceLayout, terminalId, displacedId)!
          if (tabFocus[sourceTabId] === terminalId || countLeaves(sourceLayout) === 1) tabFocus[sourceTabId] = displacedId
        }
        const next = { ...state, layouts, tabFocus }
        return toTabId === next.activeTabId ? withActive(next, toTabId, terminalId) : next
      }

      let working = sourceTabId ? removeFromTab(state, sourceTabId, terminalId) : state
      const baseLayout = working.layouts[toTabId]
      if (!baseLayout || !leaves(baseLayout).includes(targetLeafId)) return state
      if (countLeaves(baseLayout) >= 9) return state
      const dir: Dir = zone === 'left' || zone === 'right' ? 'h' : 'v'
      const side: Side = zone === 'left' || zone === 'top' ? 'before' : 'after'
      const split = splitLeaf(baseLayout, targetLeafId, dir, terminalId, side)!
      const layouts = { ...working.layouts, [toTabId]: rebalanceChain(split, terminalId)! }
      const tabFocus = { ...working.tabFocus, [toTabId]: terminalId }
      const next = { ...working, layouts, tabFocus }
      return toTabId === next.activeTabId ? withActive(next, toTabId, terminalId) : next
    }

    case 'SET_THEME':
      if (state.settings.theme === action.theme) return state
      return { ...state, settings: { ...state.settings, theme: action.theme } }

    case 'ADD_FOLDER':
      return { ...state, folders: { ...state.folders, [action.folder.id]: action.folder } }

    case 'RENAME_FOLDER': {
      const f = state.folders[action.id]
      const name = action.name.trim()
      if (!f || !name || f.name === name) return state
      return { ...state, folders: { ...state.folders, [action.id]: { ...f, name } } }
    }

    case 'DELETE_FOLDER': {
      if (!state.folders[action.id]) return state
      const folders = { ...state.folders }
      delete folders[action.id]
      const hasTerminals = Object.values(state.terminals).some((t) => t.folderId === action.id)
      let terminals = state.terminals
      if (hasTerminals) {
        const next: Record<string, Terminal> = {}
        for (const [id, t] of Object.entries(state.terminals)) {
          if (t.folderId === action.id) {
            const { folderId: _, ...rest } = t
            next[id] = rest
          } else {
            next[id] = t
          }
        }
        terminals = next
      }
      return {
        ...state,
        folders,
        terminals,
        selectedFolderId: state.selectedFolderId === action.id ? null : state.selectedFolderId
      }
    }

    case 'SET_FOLDER_COLLAPSED': {
      const f = state.folders[action.id]
      if (!f || f.collapsed === action.collapsed) return state
      return { ...state, folders: { ...state.folders, [action.id]: { ...f, collapsed: action.collapsed } } }
    }

    case 'REORDER_FOLDERS': {
      const ids = action.ids.filter((id) => state.folders[id])
      if (ids.length === 0 || ids.every((id, i) => state.folders[id]!.order === i)) return state
      const folders = { ...state.folders }
      ids.forEach((id, i) => {
        folders[id] = { ...folders[id]!, order: i }
      })
      return { ...state, folders }
    }

    case 'MOVE_TERMINAL': {
      const t = state.terminals[action.id]
      if (!t) return state
      if (action.folderId && !state.folders[action.folderId]) return state
      if ((t.folderId ?? null) === action.folderId) return state
      const { folderId: _, ...rest } = t
      const next: Terminal = action.folderId ? { ...rest, folderId: action.folderId } : rest
      return { ...state, terminals: { ...state.terminals, [action.id]: next } }
    }

    case 'SELECT_FOLDER':
      if (action.id && !state.folders[action.id]) return state
      if (state.selectedFolderId === action.id) return state
      return { ...state, selectedFolderId: action.id }

    case 'REORDER_TABS': {
      const same =
        action.ids.length === state.openTabs.length &&
        new Set(action.ids).size === action.ids.length &&
        action.ids.every((id) => state.openTabs.includes(id))
      if (!same) return state
      return { ...state, openTabs: action.ids }
    }

    case 'SET_SIDEBAR':
      if (state.sidebarOpen === action.open) return state
      return { ...state, sidebarOpen: action.open }

    case 'TOUCH_PROJECT': {
      const rest = state.settings.recentProjects.filter((p) => p !== action.path)
      const recentProjects = [action.path, ...rest].slice(0, MAX_RECENT)
      return { ...state, settings: { ...state.settings, recentProjects } }
    }
  }
}

export class Store {
  private _state: AppState
  private listeners = new Set<(s: AppState) => void>()

  constructor(initial: AppState) {
    this._state = initial
  }

  get state(): AppState {
    return this._state
  }

  dispatch(action: Action): void {
    const next = reduce(this._state, action)
    if (next === this._state) return
    this._state = next
    for (const fn of this.listeners) fn(next)
  }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
