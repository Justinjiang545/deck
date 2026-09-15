import type { AppState, Folder, Terminal } from '../shared/state'

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

const MAX_RECENT = 20

function withActive(state: AppState, activeTabId: string | null): AppState {
  return {
    ...state,
    activeTabId,
    layout: activeTabId ? { type: 'leaf', terminalId: activeTabId } : null,
    focusedTerminalId: activeTabId
  }
}

function closeTab(state: AppState, id: string): AppState {
  const i = state.openTabs.indexOf(id)
  if (i === -1) return state
  const openTabs = state.openTabs.filter((t) => t !== id)
  let active = state.activeTabId
  if (active === id) active = openTabs[i] ?? openTabs[i - 1] ?? null
  return withActive({ ...state, openTabs }, active)
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
      return closeTab({ ...state, terminals }, action.id)
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
      if (state.activeTabId === action.id && state.openTabs.includes(action.id) && state.selectedFolderId === folderId) {
        return state
      }
      const openTabs = state.openTabs.includes(action.id) ? state.openTabs : [...state.openTabs, action.id]
      return withActive({ ...state, openTabs, selectedFolderId: folderId }, action.id)
    }

    case 'CLOSE_PANE':
      return closeTab(state, action.id)

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
