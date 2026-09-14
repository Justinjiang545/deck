import type { AppState, Terminal } from '../shared/state'

export type Action =
  | { type: 'HYDRATE'; state: AppState }
  | { type: 'ADD_TERMINAL'; terminal: Terminal }
  | { type: 'REMOVE_TERMINAL'; id: string }
  | { type: 'UPDATE_TERMINAL'; id: string; patch: Partial<Pick<Terminal, 'cwd' | 'fgCommand' | 'lastActivity'>> }
  | { type: 'RENAME_TERMINAL'; id: string; title: string | null }
  | { type: 'SHOW_TERMINAL'; id: string }
  | { type: 'CLOSE_PANE'; id: string }
  | { type: 'SET_SIDEBAR'; open: boolean }
  | { type: 'TOUCH_PROJECT'; path: string }

const MAX_RECENT = 20

function shownId(state: AppState): string | null {
  return state.layout?.type === 'leaf' ? state.layout.terminalId : null
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
      const wasShown = shownId(state) === action.id
      return {
        ...state,
        terminals,
        layout: wasShown ? null : state.layout,
        focusedTerminalId: state.focusedTerminalId === action.id ? null : state.focusedTerminalId
      }
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

    case 'SHOW_TERMINAL':
      if (!state.terminals[action.id]) return state
      return { ...state, layout: { type: 'leaf', terminalId: action.id }, focusedTerminalId: action.id }

    case 'CLOSE_PANE':
      if (shownId(state) !== action.id) return state
      return { ...state, layout: null, focusedTerminalId: null }

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
