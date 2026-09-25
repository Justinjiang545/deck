import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useAppState } from './useAppState'
import Sidebar from './Sidebar'
import SidebarRail from './SidebarRail'
import TabBar from './TabBar'
import SplitView from './SplitView'
import Palette, { type PaletteItem } from './Palette'
import type { ProjectEntry } from '../../shared/ipc'
import { sortedTerminals } from '../../shared/state'
import { splitWouldBeTooSmall } from './paneSize'

const PANE_CAP_HINT_MS = 1400
const MAX_PANES_HINT = 'Max 9 panes per tab'
const TOO_SMALL_HINT = 'Pane too small to split'

export default function App(): JSX.Element {
  const state = useAppState()
  const [picker, setPicker] = useState<ProjectEntry[] | null>(null)
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null)
  const [capHint, setCapHint] = useState<string | null>(null)
  const capHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Zoom is view-only state, deliberately not persisted or round-tripped through main: it
  // resets whenever the active tab changes (below) since it wouldn't make sense to carry a
  // zoomed pane id across an unrelated tab's layout.
  const [zoomedId, setZoomedId] = useState<string | null>(null)

  useEffect(() => { setZoomedId(null) }, [state?.activeTabId])

  // Reflect the active theme on the document root so styles.css can key off it.
  useEffect(() => {
    if (state) document.documentElement.dataset.theme = state.settings.theme
  }, [state?.settings.theme])

  const showCapHint = useCallback((message: string = MAX_PANES_HINT) => {
    setCapHint(message)
    if (capHintTimer.current) clearTimeout(capHintTimer.current)
    capHintTimer.current = setTimeout(() => setCapHint(null), PANE_CAP_HINT_MS)
  }, [])

  const openPicker = useCallback(async () => {
    const projects = await window.deck.listProjects()
    setPicker(projects)
  }, [])

  // createTerminal can reject (e.g. `tmux new-session` fails) — never let that surface as an
  // unhandled rejection; just log it and close the picker.
  const createTerminal = useCallback((cwd: string | null) => {
    window.deck.createTerminal(cwd).catch((err) => {
      console.error('createTerminal failed', err)
      setPicker(null)
    })
  }, [])

  // ⌘⌥Arrow: focus the nearest pane in that direction, by on-screen geometry (works for any
  // tree shape without walking the layout tree). Panes are marked with data-terminal-id.
  const focusNeighborPane = useCallback(
    (arrow: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
      if (!state?.activeTabId || !state.focusedTerminalId) return
      const cur = document.querySelector<HTMLElement>(`.pane-slot[data-terminal-id="${CSS.escape(state.focusedTerminalId)}"]`)
      if (!cur) return
      const c = cur.getBoundingClientRect()
      const ccx = c.left + c.width / 2
      const ccy = c.top + c.height / 2
      let best: { id: string; score: number } | null = null
      for (const el of document.querySelectorAll<HTMLElement>('.pane-slot')) {
        const id = el.dataset.terminalId
        if (!id || id === state.focusedTerminalId) continue
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        let primary: number, perpendicular: number
        if (arrow === 'ArrowLeft') { if (cx >= ccx - 1) continue; primary = ccx - cx; perpendicular = Math.abs(cy - ccy) }
        else if (arrow === 'ArrowRight') { if (cx <= ccx + 1) continue; primary = cx - ccx; perpendicular = Math.abs(cy - ccy) }
        else if (arrow === 'ArrowUp') { if (cy >= ccy - 1) continue; primary = ccy - cy; perpendicular = Math.abs(cx - ccx) }
        else { if (cy <= ccy + 1) continue; primary = cy - ccy; perpendicular = Math.abs(cx - ccx) }
        const score = primary + perpendicular * 2
        if (!best || score < best.score) best = { id, score }
      }
      if (best) window.deck.focusPane(state.activeTabId, best.id)
    },
    [state]
  )

  // Global shortcuts. Returns true if handled.
  const handleKey = useCallback((e: KeyboardEvent): boolean => {
    if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.code)) {
      focusNeighborPane(e.code as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown')
      return true
    }
    if (!e.metaKey || e.ctrlKey || e.altKey) return false
    const k = e.key.toLowerCase()
    if (k === 't' && !e.shiftKey) { void openPicker(); return true }
    if (k === 'b' && !e.shiftKey) { if (state) void window.deck.setSidebar(!state.sidebarOpen); return true }
    if (k === 'd') {
      const tabId = state?.activeTabId
      const leafId = state?.focusedTerminalId
      if (!tabId || !leafId) return true
      const dir = e.shiftKey ? 'v' : 'h'
      if (splitWouldBeTooSmall(state.layout, leafId, dir)) { showCapHint(TOO_SMALL_HINT); return true }
      window.deck.splitPane(tabId, leafId, dir, 'after').then((id) => {
        if (id === null) showCapHint()
      }).catch((err) => console.error('splitPane failed', err))
      return true
    }
    if (k === 'w') {
      const tabId = state?.activeTabId
      const leafId = state?.focusedTerminalId
      if (!tabId || !leafId) return true
      if (e.shiftKey) void window.deck.killTerminal(leafId)
      else void window.deck.closeLeaf(tabId, leafId)
      return true
    }
    if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      if (state && state.openTabs.length >= 2) {
        const tabs = state.openTabs
        const idx = state.activeTabId ? tabs.indexOf(state.activeTabId) : -1
        const dir = e.code === 'BracketRight' ? 1 : -1
        const next = idx === -1 ? 0 : (idx + dir + tabs.length) % tabs.length
        const id = tabs[next]
        if (id) void window.deck.activateTab(id)
      }
      return true
    }
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const id = state?.openTabs[Number(e.code.slice(5)) - 1]
      if (id) void window.deck.activateTab(id)
      return true
    }
    if (k === 'n' && e.shiftKey) {
      window.deck.createFolder('New folder').catch((err) => console.error('createFolder failed', err))
      return true
    }
    if (k === 'g' && e.shiftKey) {
      window.deck.tileTabs().catch((err) => console.error('tileTabs failed', err))
      return true
    }
    if (k === 'a' && e.shiftKey) {
      if (!state) return true
      const pending = sortedTerminals(state).filter((t) => t.cc?.unseen)
      if (pending.length === 0) return true
      const curIdx = pending.findIndex((t) => t.id === state.focusedTerminalId)
      const next = pending[(curIdx + 1) % pending.length]!
      void window.deck.showTerminal(next.id)
      return true
    }
    if (e.shiftKey && e.key === 'Enter') {
      if (state?.focusedTerminalId) {
        const id = state.focusedTerminalId
        setZoomedId((z) => (z === id ? null : id))
      }
      return true
    }
    return false
  }, [openPicker, state, focusNeighborPane, showCapHint])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (handleKey(e)) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleKey])

  // Native row context menu's "Rename" asks the matching sidebar row to enter edit mode.
  useEffect(() => window.deck.onRenameRequest((id) => setEditingTerminalId(id)), [])

  // Without this, a Finder file dropped anywhere outside a folder section (the pane, the
  // tab bar) navigates the window to file://… and replaces the app.
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault()
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [])

  // xterm sees keys first; let the app own our shortcuts, pass everything else through.
  const keyFilter = useCallback((e: KeyboardEvent): boolean => {
    if (e.type !== 'keydown') return true
    if (e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey && /^Arrow(Left|Right|Up|Down)$/.test(e.code)) return false
    if (!e.metaKey || e.ctrlKey || e.altKey) return true
    const k = e.key.toLowerCase()
    if ((k === 't' || k === 'b') && !e.shiftKey) return false
    if (k === 'w') return false
    if (k === 'd') return false
    if (k === 'n' && e.shiftKey) return false
    if (k === 'g' && e.shiftKey) return false
    if (k === 'a' && e.shiftKey) return false
    if (e.shiftKey && e.key === 'Enter') return false
    if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) return false
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) return false
    return true
  }, [])

  if (!state) return <div className="app" />

  const items: PaletteItem[] = (picker ?? []).map((p) => ({ id: p.path, label: p.name, detail: p.path.replace(/^\/Users\/[^/]+/, '~') }))

  return (
    <div className={'app' + (!state.sidebarOpen ? ' app--nosidebar' : '')}>
      {state.sidebarOpen ? (
        <Sidebar
          state={state}
          onNew={() => void openPicker()}
          editingTerminalId={editingTerminalId}
          onTerminalEditDone={() => setEditingTerminalId(null)}
        />
      ) : (
        <SidebarRail state={state} onNew={() => void openPicker()} />
      )}
      <main className="main">
        <TabBar state={state} />
        {state.activeTabId && state.layout ? (
          <SplitView
            key={state.activeTabId}
            tabId={state.activeTabId}
            layout={state.layout}
            settings={state.settings}
            terminals={state.terminals}
            focusedTerminalId={state.focusedTerminalId}
            zoomedId={zoomedId}
            onUnzoom={() => setZoomedId(null)}
            keyFilter={keyFilter}
            onFocusPane={(id) => window.deck.focusPane(state.activeTabId!, id)}
            onCapHit={showCapHint}
          />
        ) : (
          <div className="empty">
            <svg className="empty__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6.5 9l3.5 3-3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 15h5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div className="empty__title">No terminal open</div>
            <div className="empty__hint">⌘T to create one, or pick one on the left.</div>
            <button className="btn empty__cta" onClick={() => void openPicker()} title="New terminal (⌘T)">+ Terminal</button>
          </div>
        )}
        {capHint && <div className="cap-hint">{capHint}</div>}
      </main>
      {picker && (
        <Palette
          placeholder="Open terminal in project… (Esc = home)"
          items={items}
          onPick={(c) => {
            setPicker(null)
            createTerminal('item' in c ? c.item.id : c.raw)
          }}
          onClose={() => { setPicker(null); createTerminal(null) }}
          onDismiss={() => setPicker(null)}
        />
      )}
    </div>
  )
}
