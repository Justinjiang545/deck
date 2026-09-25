import type { AppState, ThemeName } from './state'
import type { Dir, PathStep, Side } from './layout'
import type { ProjectEntry } from '../main/projects'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export const CH = {
  getState: 'state:get',
  stateChanged: 'state:changed',
  createTerminal: 'terminal:create',
  killTerminal: 'terminal:kill',
  renameTerminal: 'terminal:rename',
  showTerminal: 'terminal:show',
  closePane: 'terminal:closePane',
  setSidebar: 'sidebar:set',
  listProjects: 'projects:list',
  ptyAttach: 'pty:attach',
  ptyDetach: 'pty:detach',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  createFolder: 'folder:create',
  renameFolder: 'folder:rename',
  deleteFolder: 'folder:delete',
  setFolderCollapsed: 'folder:collapsed',
  reorderFolders: 'folder:reorder',
  moveTerminal: 'terminal:move',
  selectFolder: 'folder:select',
  reorderTabs: 'tabs:reorder',
  activateTab: 'tabs:activate',
  showRowMenu: 'terminal:menu',
  renameRequest: 'terminal:renameRequest',
  savePaste: 'files:savePaste',
  splitPane: 'layout:split',
  closeLeaf: 'layout:closeLeaf',
  setRatio: 'layout:setRatio',
  movePane: 'layout:movePane',
  focusPane: 'layout:focusPane',
  tileTabs: 'layout:tileTabs',
  setTheme: 'settings:setTheme'
} as const

export type { ProjectEntry }

export interface DeckApi {
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  createTerminal(cwd: string | null): Promise<string>
  killTerminal(id: string): Promise<boolean>
  renameTerminal(id: string, title: string | null): Promise<void>
  showTerminal(id: string): Promise<void>
  closePane(id: string): Promise<void>
  setSidebar(open: boolean): Promise<void>
  listProjects(): Promise<ProjectEntry[]>
  ptyAttach(id: string, cols: number, rows: number): Promise<void>
  ptyDetach(id: string): Promise<void>
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string) => void): () => void
  createFolder(name: string): Promise<string>
  renameFolder(id: string, name: string): Promise<void>
  deleteFolder(id: string): Promise<void>
  setFolderCollapsed(id: string, collapsed: boolean): Promise<void>
  reorderFolders(ids: string[]): Promise<void>
  moveTerminal(id: string, folderId: string | null): Promise<void>
  selectFolder(id: string | null): Promise<void>
  reorderTabs(ids: string[]): Promise<void>
  /** Switch the active tab directly by tab id — no terminal lookup, works even if the tab's anchor terminal moved elsewhere. */
  activateTab(id: string): Promise<void>
  showRowMenu(id: string): Promise<void>
  onRenameRequest(cb: (id: string) => void): () => void
  /** Absolute path of a dropped File (Electron webUtils); '' if it has none (e.g. an image dragged from a browser). */
  pathForFile(file: File): string
  /** Persist pasted/dropped image bytes under the app's pastes dir; returns the absolute path. */
  savePaste(bytes: Uint8Array, ext: string): Promise<string>
  /** Split `leafId` in tab `tabId`, spawning a new terminal in the leaf's cwd. Returns the new terminal id, or null (cap hit / leaf gone). */
  splitPane(tabId: string, leafId: string, dir: Dir, side?: Side): Promise<string | null>
  /** Detach and remove one pane from a tab; if it was the last pane, the tab closes (same as closePane). */
  closeLeaf(tabId: string, terminalId: string): Promise<void>
  /** Fire-and-forget; called continuously while dragging a divider. */
  setRatio(tabId: string, path: PathStep[], ratio: number): void
  /** Move (or, for 'center', swap-replace) `terminalId` into tab `toTabId` relative to `targetLeafId`. */
  movePane(terminalId: string, toTabId: string, targetLeafId: string, zone: DropZone): Promise<void>
  /** Focus a pane already visible in the active tab (click, or ⌘⌥Arrow) without touching folder selection. */
  focusPane(tabId: string, terminalId: string): void
  /** ⌘⇧G: gather one terminal per open tab into the active tab as a balanced grid (up to MAX_PANES; extra tabs are left open). */
  tileTabs(): Promise<void>
  setTheme(theme: ThemeName): Promise<void>
}

declare global {
  interface Window {
    deck: DeckApi
  }
}
