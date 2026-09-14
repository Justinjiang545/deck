import { app, BrowserWindow, dialog } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { initialState } from '../shared/state'
import { Store } from './store'
import { loadState, createSaver } from './persist'
import { findTmux, Tmux } from './tmux'
import { PtyManager } from './pty'
import { startPoller, reconcile, CREATE_GRACE_MS } from './poller'
import { registerIpc } from './ipc'
import { CH } from '../shared/ipc'

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 400,
    title: 'deck',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0e0f11',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  w.on('closed', () => { if (win === w) { win = null; ptysRef?.detachAll() } })
  return w
}

/** Guards every push to the renderer against a destroyed/gone webContents. */
function send(channel: string, ...args: unknown[]): void {
  const w = win
  if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
}

let ptysRef: PtyManager | null = null

function confPath(): string {
  // dev: <repo>/resources/deck.conf ; packaged: <app>/resources/deck.conf (see electron-builder extraResources, Phase 5)
  return app.isPackaged ? join(process.resourcesPath, 'deck.conf') : join(app.getAppPath(), 'resources', 'deck.conf')
}

async function boot(): Promise<void> {
  const bin = findTmux()
  if (!bin) {
    await dialog.showMessageBox({ type: 'error', message: 'tmux not found', detail: 'Install it with:  brew install tmux\nThen relaunch deck.' })
    app.quit()
    return
  }
  const tmux = new Tmux({ bin, conf: confPath() })
  const stateFile = join(app.getPath('userData'), 'state.json')
  const store = new Store(loadState(stateFile, initialState(homedir())))
  const saver = createSaver(stateFile)
  store.subscribe((s) => saver.schedule(s))

  // Reconcile persisted state with what tmux actually has (adopt orphans, drop dead) before showing UI.
  // Use now + CREATE_GRACE_MS as the reconcile clock (no grace window at boot), then stamp any
  // adopted terminal's createdAt/lastActivity back to the real "now" so sort order stays sane.
  const panes = await tmux.listPanes()
  const now = Date.now()
  for (const a of reconcile(store.state.terminals, panes, now + CREATE_GRACE_MS)) {
    if (a.type === 'ADD_TERMINAL') {
      a.terminal.createdAt = now
      a.terminal.lastActivity = now
    }
    store.dispatch(a)
  }

  const ptys = new PtyManager(tmux, {
    data: (id, data) => send(CH.ptyData, id, data),
    exit: (id) => send(CH.ptyExit, id)
  })
  ptysRef = ptys

  registerIpc({ store, tmux, ptys, win: () => win, send })
  win = createWindow()
  const stopPoller = startPoller(tmux, store)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  app.on('before-quit', () => {
    stopPoller()
    ptys.detachAll()
    saver.flush()
  })
}

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox('deck failed to start', String(err))
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
