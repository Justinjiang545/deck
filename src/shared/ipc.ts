import type { AppState } from './state'
import type { ProjectEntry } from '../main/projects'

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
  showRowMenu: 'terminal:menu',
  renameRequest: 'terminal:renameRequest'
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
  showRowMenu(id: string): Promise<void>
  onRenameRequest(cb: (id: string) => void): () => void
}

declare global {
  interface Window {
    deck: DeckApi
  }
}
