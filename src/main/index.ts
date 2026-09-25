import { app, BrowserWindow, dialog } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { initialState, unseenCount } from '../shared/state'
import { Store } from './store'
import { loadState, createSaver } from './persist'
import { findTmux, Tmux } from './tmux'
import { PtyManager } from './pty'
import { startPoller, reconcile, newMemo, CREATE_GRACE_MS } from './poller'
import { registerIpc } from './ipc'
import { CH } from '../shared/ipc'
import { installHooks, writeHookScript } from './hookInstall'
import { startHooksServer, type HooksServerHandle } from './hooksServer'
import { notifyAttention, updateDockBadge } from './notify'

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

let hooksServerRef: HooksServerHandle | null = null

async function boot(): Promise<void> {
  const bin = findTmux()
  if (!bin) {
    await dialog.showMessageBox({ type: 'error', message: 'tmux not found', detail: 'Install it with:  brew install tmux\nThen relaunch deck.' })
    app.quit()
    return
  }
  // Own hooks socket per deck instance (a different --user-data-dir, e.g. an isolated test
  // run, gets its own path and thus its own events). New tmux sessions get this as
  // DECK_HOOK_SOCK so the hook script only reports when running inside a deck terminal.
  const hookSockPath = join(app.getPath('userData'), 'hooks.sock')
  const tmux = new Tmux({ bin, conf: confPath(), hookSock: hookSockPath })
  const stateFile = join(app.getPath('userData'), 'state.json')
  const store = new Store(loadState(stateFile, initialState(homedir())))
  const saver = createSaver(stateFile)
  store.subscribe((s) => saver.schedule(s))
  store.subscribe((s) => updateDockBadge(unseenCount(s)))

  // Reconcile persisted state with what tmux actually has (adopt orphans, drop dead) before showing UI.
  // Use now + CREATE_GRACE_MS as the reconcile clock (no grace window at boot), then stamp any
  // adopted terminal's createdAt/lastActivity back to the real "now" so sort order stays sane.
  // If tmux can't be read right now, keep the persisted list untouched; the poller reconciles later.
  let panes: Awaited<ReturnType<typeof tmux.listPanes>> | null = null
  try { panes = await tmux.listPanes() } catch (err) { console.warn('[boot] tmux unreadable, skipping reconcile:', err) }
  if (panes) {
    const now = Date.now()
    for (const a of reconcile(store.state.terminals, panes, now + CREATE_GRACE_MS, newMemo(), 1)) {
      if (a.type === 'ADD_TERMINAL') {
        a.terminal.createdAt = now
        a.terminal.lastActivity = now
      }
      store.dispatch(a)
    }
  }

  const ptys = new PtyManager(tmux, {
    data: (id, data) => send(CH.ptyData, id, data),
    exit: (id) => send(CH.ptyExit, id)
  })
  ptysRef = ptys

  registerIpc({ store, tmux, ptys, win: () => win, send })
  win = createWindow()
  const stopPoller = startPoller(tmux, store)

  // Hook install/script write is best-effort and must never block boot: a stale or unwritable
  // ~/.claude/settings.json just means CC status won't update from hooks (the poller's
  // fgCommand-based fallback still runs).
  try {
    const scriptPath = join(homedir(), '.deck', 'claude-hook.sh')
    writeHookScript(scriptPath)
    const result = installHooks(join(homedir(), '.claude', 'settings.json'), scriptPath)
    if (!result.installed) console.warn('[boot] installHooks skipped:', result.reason)
  } catch (err) {
    console.warn('[boot] hook install failed:', err)
  }

  hooksServerRef = startHooksServer({
    store,
    socketPath: hookSockPath,
    isVisible: (id) => !!win && !win.isDestroyed() && win.isFocused() && store.state.focusedTerminalId === id,
    onAttention: (id, cc) => {
      const t = store.state.terminals[id]
      if (!t) return
      notifyAttention(t, cc, {
        sound: store.state.settings.sound,
        onClick: () => {
          if (win && !win.isDestroyed()) { win.show(); win.focus() }
          store.dispatch({ type: 'SHOW_TERMINAL', id })
        }
      })
    },
    log: (...args) => console.warn(...args)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  app.on('before-quit', () => {
    stopPoller()
    hooksServerRef?.close()
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
