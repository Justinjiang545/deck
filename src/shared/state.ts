import { leaves } from './layout'

export type CCStatus = 'working' | 'needs-you' | 'idle'
/** Sub-kind of 'needs-you': did CC finish (Stop) or is it waiting on permission/input (Notification)? */
export type CCAttention = 'done' | 'input'

export interface Terminal {
  id: string
  createdAt: number
  customTitle?: string
  cwd: string
  fgCommand: string
  /** Something other than the root shell owns the tty foreground (see main/procs.ts). Absent = unknown/false. */
  busy?: boolean
  lastActivity: number
  cc: null | {
    sessionId?: string
    status: CCStatus
    attention?: CCAttention
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
  /**
   * Mirrors `layouts[activeTabId]` (null when no tab is active). Kept in sync by the reducer
   * so existing single-pane call sites can keep reading "the layout" without knowing about
   * tabs; the source of truth for every tab (active or not) is `layouts`.
   */
  layout: Layout | null
  focusedTerminalId: string | null
  sidebarOpen: boolean
  settings: Settings
  folders: Record<string, Folder>
  /**
   * Tab ids, in open order. A tab id is the id of the terminal it was opened for (its
   * "anchor") — the simplest extension of the pre-splits model, where openTabs entries were
   * terminal ids 1:1. Splits can move that anchor terminal into another tab's layout without
   * closing this tab, so don't assume `terminals[tabId]` exists; resolve a tab's terminals via
   * `layouts[tabId]` (see `shared/layout.ts`).
   */
  openTabs: string[]
  activeTabId: string | null
  /** Each open tab's own split layout tree (Phase 4). Always has an entry for every id in openTabs. */
  layouts: Record<string, Layout>
  /** Last-focused pane per tab, so switching tabs and back restores focus. */
  tabFocus: Record<string, string>
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
    layouts: {},
    tabFocus: {},
    selectedFolderId: null
  }
}

export const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', '-zsh', '-bash', 'login'])

/** What the terminal is doing right now, from its foreground process: idle prompt, claude, or any other running command. */
export type Activity = 'idle' | 'claude' | 'busy'

export function activityOf(t: Terminal): Activity {
  if (t.fgCommand === 'claude') return 'claude'
  if (t.busy) return 'busy'
  if (!t.fgCommand || SHELLS.has(t.fgCommand)) return 'idle'
  return 'busy'
}

/** What the CC status dot/glyph should show, derived from hook-driven `cc` state (distinct from `activityOf`, which is fgCommand-based). */
export type CcVisual = 'working' | 'done' | 'input' | 'idle'

export function ccVisualOf(t: Terminal): CcVisual | null {
  if (!t.cc) return null
  if (t.cc.status === 'working') return 'working'
  if (t.cc.status === 'needs-you') return t.cc.attention === 'input' ? 'input' : 'done'
  return 'idle'
}

export function unseenCount(state: AppState): number {
  return Object.values(state.terminals).filter((t) => t.cc?.unseen).length
}

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
  return state.selectedFolderId
}

/** Every terminal id currently visible in some tab's split layout. */
export function openTerminalIds(state: AppState): Set<string> {
  const ids = new Set<string>()
  for (const tabId of state.openTabs) {
    for (const id of leaves(state.layouts[tabId] ?? null)) ids.add(id)
  }
  return ids
}

/**
 * The terminal a tab should show in the tab bar: its last-focused pane if that pane is still
 * in the tree, else the tree's first leaf, else (a tab with no layout at all — shouldn't
 * normally happen) its own id.
 */
export function representativeTerminal(state: AppState, tabId: string): Terminal | undefined {
  const layout = state.layouts[tabId] ?? null
  const remembered = tabId === state.activeTabId ? state.focusedTerminalId : state.tabFocus[tabId]
  const ls = leaves(layout)
  const id = (remembered && ls.includes(remembered) ? remembered : ls[0]) ?? tabId
  return state.terminals[id]
}
