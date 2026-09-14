export type CCStatus = 'working' | 'needs-you' | 'idle'

export interface Terminal {
  id: string
  createdAt: number
  customTitle?: string
  cwd: string
  fgCommand: string
  lastActivity: number
  cc: null | {
    sessionId?: string
    status: CCStatus
    lastMessage?: string
    unseen: boolean
  }
  folderId?: string
}

export interface Folder {
  id: string
  name: string
  order: number
  collapsed: boolean
}

export type Layout =
  | { type: 'leaf'; terminalId: string }
  | { type: 'split'; dir: 'h' | 'v'; ratio: number; a: Layout; b: Layout }

export type ThemeName = 'graphite' | 'ember' | 'tide' | 'paper'

export interface Settings {
  theme: ThemeName
  fontFamily: string
  fontSize: number
  sound: boolean
  projectRoots: string[]
  recentProjects: string[]
}

export interface AppState {
  terminals: Record<string, Terminal>
  layout: Layout | null
  focusedTerminalId: string | null
  sidebarOpen: boolean
  settings: Settings
  folders: Record<string, Folder>
  openTabs: string[]
  activeTabId: string | null
  selectedFolderId: string | null
}

export function defaultSettings(home: string): Settings {
  return {
    theme: 'graphite',
    fontFamily: 'JetBrains Mono, Menlo, monospace',
    fontSize: 13,
    sound: true,
    projectRoots: [`${home}/Documents/GitHub`],
    recentProjects: []
  }
}

export function initialState(home: string): AppState {
  return {
    terminals: {},
    layout: null,
    focusedTerminalId: null,
    sidebarOpen: true,
    settings: defaultSettings(home),
    folders: {},
    openTabs: [],
    activeTabId: null,
    selectedFolderId: null
  }
}

export const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', '-zsh', '-bash', 'login'])

export function titleOf(t: Terminal): string {
  if (t.customTitle) return t.customTitle
  if (t.fgCommand && !SHELLS.has(t.fgCommand)) return t.fgCommand
  const b = t.cwd.split('/').filter(Boolean).pop() ?? ''
  return b === '' ? t.cwd : b
}

export function sortedTerminals(state: AppState): Terminal[] {
  return Object.values(state.terminals).sort((a, b) => a.createdAt - b.createdAt)
}

export function sortedFolders(state: AppState): Folder[] {
  return Object.values(state.folders).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function terminalsInFolder(state: AppState, folderId: string | null): Terminal[] {
  return sortedTerminals(state).filter((t) => (t.folderId ?? null) === folderId)
}

export function placementFolder(state: AppState): string | null {
  const focused = state.focusedTerminalId ? state.terminals[state.focusedTerminalId] : undefined
  if (focused) return focused.folderId ?? null
  return state.selectedFolderId
}
