import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH, type DeckApi } from '../shared/ipc'
import type { AppState } from '../shared/state'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DeckApi = {
  getState: () => ipcRenderer.invoke(CH.getState),
  onState: (cb) => on<[AppState]>(CH.stateChanged, cb),
  createTerminal: (cwd) => ipcRenderer.invoke(CH.createTerminal, cwd),
  killTerminal: (id) => ipcRenderer.invoke(CH.killTerminal, id),
  renameTerminal: (id, title) => ipcRenderer.invoke(CH.renameTerminal, id, title),
  showTerminal: (id) => ipcRenderer.invoke(CH.showTerminal, id),
  closePane: (id) => ipcRenderer.invoke(CH.closePane, id),
  setSidebar: (open) => ipcRenderer.invoke(CH.setSidebar, open),
  listProjects: () => ipcRenderer.invoke(CH.listProjects),
  ptyAttach: (id, cols, rows) => ipcRenderer.invoke(CH.ptyAttach, id, cols, rows),
  ptyDetach: (id) => ipcRenderer.invoke(CH.ptyDetach, id),
  ptyWrite: (id, data) => ipcRenderer.send(CH.ptyWrite, id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send(CH.ptyResize, id, cols, rows),
  onPtyData: (cb) => on<[string, string]>(CH.ptyData, cb),
  onPtyExit: (cb) => on<[string]>(CH.ptyExit, cb),
  createFolder: (name) => ipcRenderer.invoke(CH.createFolder, name),
  renameFolder: (id, name) => ipcRenderer.invoke(CH.renameFolder, id, name),
  deleteFolder: (id) => ipcRenderer.invoke(CH.deleteFolder, id),
  setFolderCollapsed: (id, collapsed) => ipcRenderer.invoke(CH.setFolderCollapsed, id, collapsed),
  reorderFolders: (ids) => ipcRenderer.invoke(CH.reorderFolders, ids),
  moveTerminal: (id, folderId) => ipcRenderer.invoke(CH.moveTerminal, id, folderId),
  selectFolder: (id) => ipcRenderer.invoke(CH.selectFolder, id),
  reorderTabs: (ids) => ipcRenderer.invoke(CH.reorderTabs, ids),
  activateTab: (id) => ipcRenderer.invoke(CH.activateTab, id),
  showRowMenu: (id) => ipcRenderer.invoke(CH.showRowMenu, id),
  onRenameRequest: (cb) => on<[string]>(CH.renameRequest, cb),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  savePaste: (bytes, ext) => ipcRenderer.invoke(CH.savePaste, bytes, ext),
  splitPane: (tabId, leafId, dir, side) => ipcRenderer.invoke(CH.splitPane, tabId, leafId, dir, side),
  closeLeaf: (tabId, terminalId) => ipcRenderer.invoke(CH.closeLeaf, tabId, terminalId),
  setRatio: (tabId, path, ratio) => ipcRenderer.send(CH.setRatio, tabId, path, ratio),
  movePane: (terminalId, toTabId, targetLeafId, zone) => ipcRenderer.invoke(CH.movePane, terminalId, toTabId, targetLeafId, zone),
  focusPane: (tabId, terminalId) => ipcRenderer.send(CH.focusPane, tabId, terminalId),
  tileTabs: () => ipcRenderer.invoke(CH.tileTabs),
  setTheme: (theme) => ipcRenderer.invoke(CH.setTheme, theme)
}

contextBridge.exposeInMainWorld('deck', api)
