import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { CH, type DropZone } from '../shared/ipc'
import { placementFolder, SHELLS, sortedFolders, type ThemeName } from '../shared/state'
import { countLeaves, leaves, MAX_PANES, type Dir, type PathStep, type Side } from '../shared/layout'
import type { Store } from './store'
import type { Tmux } from './tmux'
import type { PtyManager } from './pty'
import { listProjects } from './projects'

export function registerIpc(deps: {
  store: Store
  tmux: Tmux
  ptys: PtyManager
  win: () => BrowserWindow | null
  send: (channel: string, ...args: unknown[]) => void
}): void {
  const { store, tmux, ptys, send } = deps

  store.subscribe((s) => send(CH.stateChanged, s))

  ipcMain.handle(CH.getState, () => store.state)

  async function killTerminal(id: string): Promise<boolean> {
    const t = store.state.terminals[id]
    if (!t) return true
    if (t.busy || !SHELLS.has(t.fgCommand)) {
      const w = deps.win()
      const opts = {
        type: 'warning' as const,
        buttons: ['Kill', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `"${t.fgCommand}" is still running in this terminal.`,
        detail: 'Killing the terminal will end it.'
      }
      const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
      if (r.response !== 0) return false
    }
    await ptys.detach(id)
    await tmux.kill(id).catch(() => {})
    store.dispatch({ type: 'REMOVE_TERMINAL', id })
    return true
  }

  ipcMain.handle(CH.createTerminal, async (_e, cwd: string | null) => {
    const raw = cwd?.trim()
    const dir = raw ? raw.replace(/^~(?=$|\/)/, homedir()) : homedir()
    const id = randomUUID()
    await tmux.newSession(id, dir)
    const now = Date.now()
    const folderId = placementFolder(store.state)
    store.dispatch({
      type: 'ADD_TERMINAL',
      terminal: { id, createdAt: now, cwd: dir, fgCommand: 'zsh', lastActivity: now, cc: null, ...(folderId ? { folderId } : {}) }
    })
    if (raw) store.dispatch({ type: 'TOUCH_PROJECT', path: dir })
    store.dispatch({ type: 'SHOW_TERMINAL', id })
    return id
  })

  ipcMain.handle(CH.killTerminal, async (_e, id: string) => killTerminal(id))

  ipcMain.handle(CH.renameTerminal, (_e, id: string, title: string | null) => {
    store.dispatch({ type: 'RENAME_TERMINAL', id, title })
  })

  ipcMain.handle(CH.showTerminal, (_e, id: string) => {
    store.dispatch({ type: 'SHOW_TERMINAL', id })
  })

  ipcMain.handle(CH.closePane, async (_e, id: string) => {
    // `id` is a tab id, which may now own several panes — detach every terminal it holds, not
    // just `id` itself (which for a multi-pane tab may not even be a live terminal any more).
    const layout = store.state.layouts[id]
    const ids = layout ? leaves(layout) : [id]
    await Promise.all(ids.map((tid) => ptys.detach(tid)))
    store.dispatch({ type: 'CLOSE_PANE', id })
  })

  ipcMain.handle(CH.activateTab, (_e, id: string) => {
    store.dispatch({ type: 'ACTIVATE_TAB', id })
  })

  ipcMain.handle(CH.splitPane, async (_e, tabId: string, leafId: string, dir: Dir, side: Side = 'after') => {
    const layout = store.state.layouts[tabId]
    if (!layout || !leaves(layout).includes(leafId) || countLeaves(layout) >= MAX_PANES) return null
    const leafTerm = store.state.terminals[leafId]
    const cwd = leafTerm?.cwd ?? homedir()
    const id = randomUUID()
    await tmux.newSession(id, cwd)
    const now = Date.now()
    store.dispatch({ type: 'ADD_TERMINAL', terminal: { id, createdAt: now, cwd, fgCommand: 'zsh', lastActivity: now, cc: null } })
    store.dispatch({ type: 'SPLIT_PANE', tabId, leafId, dir, newTerminalId: id, side })
    return id
  })

  ipcMain.handle(CH.closeLeaf, async (_e, tabId: string, terminalId: string) => {
    await ptys.detach(terminalId)
    store.dispatch({ type: 'CLOSE_LEAF', tabId, terminalId })
  })

  ipcMain.on(CH.setRatio, (_e, tabId: string, path: PathStep[], ratio: number) => {
    store.dispatch({ type: 'SET_RATIO', tabId, path, ratio })
  })

  ipcMain.handle(CH.movePane, (_e, terminalId: string, toTabId: string, targetLeafId: string, zone: DropZone) => {
    store.dispatch({ type: 'MOVE_PANE', terminalId, toTabId, targetLeafId, zone })
  })

  ipcMain.on(CH.focusPane, (_e, tabId: string, terminalId: string) => {
    store.dispatch({ type: 'FOCUS_PANE', tabId, terminalId })
  })

  ipcMain.handle(CH.tileTabs, () => {
    store.dispatch({ type: 'TILE_TABS' })
  })

  ipcMain.handle(CH.setTheme, (_e, theme: ThemeName) => {
    store.dispatch({ type: 'SET_THEME', theme })
  })

  ipcMain.handle(CH.setSidebar, (_e, open: boolean) => {
    store.dispatch({ type: 'SET_SIDEBAR', open })
  })

  ipcMain.handle(CH.listProjects, () =>
    listProjects({
      ccProjectsDir: join(homedir(), '.claude', 'projects'),
      roots: store.state.settings.projectRoots,
      recent: store.state.settings.recentProjects
    })
  )

  ipcMain.handle(CH.ptyAttach, (_e, id: string, cols: number, rows: number) => ptys.attach(id, cols, rows))
  ipcMain.handle(CH.ptyDetach, (_e, id: string) => ptys.detach(id))
  ipcMain.on(CH.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(CH.ptyResize, (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))

  ipcMain.handle(CH.createFolder, (_e, name: string) => {
    const id = randomUUID()
    const order = Math.max(-1, ...Object.values(store.state.folders).map((f) => f.order)) + 1
    store.dispatch({ type: 'ADD_FOLDER', folder: { id, name: name.trim() || 'Folder', order, collapsed: false } })
    store.dispatch({ type: 'SELECT_FOLDER', id })
    return id
  })

  ipcMain.handle(CH.renameFolder, (_e, id: string, name: string) => {
    store.dispatch({ type: 'RENAME_FOLDER', id, name })
  })

  ipcMain.handle(CH.deleteFolder, (_e, id: string) => {
    store.dispatch({ type: 'DELETE_FOLDER', id })
  })

  ipcMain.handle(CH.setFolderCollapsed, (_e, id: string, collapsed: boolean) => {
    store.dispatch({ type: 'SET_FOLDER_COLLAPSED', id, collapsed })
  })

  ipcMain.handle(CH.reorderFolders, (_e, ids: string[]) => {
    store.dispatch({ type: 'REORDER_FOLDERS', ids })
  })

  ipcMain.handle(CH.moveTerminal, (_e, id: string, folderId: string | null) => {
    store.dispatch({ type: 'MOVE_TERMINAL', id, folderId })
  })

  ipcMain.handle(CH.selectFolder, (_e, id: string | null) => {
    store.dispatch({ type: 'SELECT_FOLDER', id })
  })

  ipcMain.handle(CH.reorderTabs, (_e, ids: string[]) => {
    store.dispatch({ type: 'REORDER_TABS', ids })
  })

  // Pasted/dropped images have no path of their own; persist them so a path can be typed into the shell.
  ipcMain.handle(CH.savePaste, (_e, bytes: Uint8Array, ext: string) => {
    const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'png'
    const dir = join(app.getPath('userData'), 'pastes')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const file = join(dir, `paste-${stamp}-${randomUUID().slice(0, 6)}.${safeExt}`)
    writeFileSync(file, Buffer.from(bytes))
    return file
  })

  ipcMain.handle(CH.showRowMenu, (_e, id: string) => {
    const t = store.state.terminals[id]
    if (!t) return
    const folders = sortedFolders(store.state)
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Rename', click: () => send(CH.renameRequest, id) },
      {
        label: 'Move to',
        submenu: [
          ...folders.map((f) => ({
            label: f.name,
            type: 'checkbox' as const,
            checked: t.folderId === f.id,
            click: () => store.dispatch({ type: 'MOVE_TERMINAL', id, folderId: f.id })
          })),
          ...(folders.length > 0 ? [{ type: 'separator' as const }] : []),
          {
            label: 'Unfiled',
            type: 'checkbox' as const,
            checked: !t.folderId,
            click: () => store.dispatch({ type: 'MOVE_TERMINAL', id, folderId: null })
          }
        ]
      },
      { type: 'separator' },
      { label: 'Kill terminal', click: () => { void killTerminal(id) } }
    ]
    const menu = Menu.buildFromTemplate(template)
    const w = deps.win()
    if (w) menu.popup({ window: w })
  })
}
