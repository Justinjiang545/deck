import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CH } from '../shared/ipc'
import { SHELLS } from '../shared/state'
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

  ipcMain.handle(CH.createTerminal, async (_e, cwd: string | null) => {
    const raw = cwd?.trim()
    const dir = raw ? raw.replace(/^~(?=$|\/)/, homedir()) : homedir()
    const id = randomUUID()
    await tmux.newSession(id, dir)
    const now = Date.now()
    store.dispatch({ type: 'ADD_TERMINAL', terminal: { id, createdAt: now, cwd: dir, fgCommand: 'zsh', lastActivity: now, cc: null } })
    if (raw) store.dispatch({ type: 'TOUCH_PROJECT', path: dir })
    store.dispatch({ type: 'SHOW_TERMINAL', id })
    return id
  })

  ipcMain.handle(CH.killTerminal, async (_e, id: string) => {
    const t = store.state.terminals[id]
    if (!t) return true
    if (!SHELLS.has(t.fgCommand)) {
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
  })

  ipcMain.handle(CH.renameTerminal, (_e, id: string, title: string | null) => {
    store.dispatch({ type: 'RENAME_TERMINAL', id, title })
  })

  ipcMain.handle(CH.showTerminal, (_e, id: string) => {
    store.dispatch({ type: 'SHOW_TERMINAL', id })
  })

  ipcMain.handle(CH.closePane, async (_e, id: string) => {
    await ptys.detach(id)
    store.dispatch({ type: 'CLOSE_PANE', id })
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
}
