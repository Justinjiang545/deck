import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useAppState } from './useAppState'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import TerminalPane from './TerminalPane'
import Palette, { type PaletteItem } from './Palette'
import type { ProjectEntry } from '../../shared/ipc'

export default function App(): JSX.Element {
  const state = useAppState()
  const [picker, setPicker] = useState<ProjectEntry[] | null>(null)
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null)

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

  // Global shortcuts. Returns true if handled.
  const handleKey = useCallback((e: KeyboardEvent): boolean => {
    if (!e.metaKey || e.ctrlKey || e.altKey) return false
    const k = e.key.toLowerCase()
    if (k === 't' && !e.shiftKey) { void openPicker(); return true }
    if (k === 'b' && !e.shiftKey) { if (state) void window.deck.setSidebar(!state.sidebarOpen); return true }
    if (k === 'w') {
      const active = state?.activeTabId
      if (!active) return true
      if (e.shiftKey) void window.deck.killTerminal(active)
      else void window.deck.closePane(active)
      return true
    }
    if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      if (state && state.openTabs.length >= 2) {
        const tabs = state.openTabs
        const idx = state.activeTabId ? tabs.indexOf(state.activeTabId) : -1
        const dir = e.code === 'BracketRight' ? 1 : -1
        const next = idx === -1 ? 0 : (idx + dir + tabs.length) % tabs.length
        const id = tabs[next]
        if (id) void window.deck.showTerminal(id)
      }
      return true
    }
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      const id = state?.openTabs[Number(e.code.slice(5)) - 1]
      if (id) void window.deck.showTerminal(id)
      return true
    }
    if (k === 'n' && e.shiftKey) {
      window.deck.createFolder('New folder').catch((err) => console.error('createFolder failed', err))
      return true
    }
    return false
  }, [openPicker, state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (handleKey(e)) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleKey])

  // Native row context menu's "Rename" asks the matching sidebar row to enter edit mode.
  useEffect(() => window.deck.onRenameRequest((id) => setEditingTerminalId(id)), [])

  // xterm sees keys first; let the app own our shortcuts, pass everything else through.
  const keyFilter = useCallback((e: KeyboardEvent): boolean => {
    if (e.type !== 'keydown') return true
    if (!e.metaKey || e.ctrlKey || e.altKey) return true
    const k = e.key.toLowerCase()
    if ((k === 't' || k === 'b') && !e.shiftKey) return false
    if (k === 'w') return false
    if (k === 'n' && e.shiftKey) return false
    if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) return false
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) return false
    return true
  }, [])

  if (!state) return <div className="app" />

  const items: PaletteItem[] = (picker ?? []).map((p) => ({ id: p.path, label: p.name, detail: p.path.replace(/^\/Users\/[^/]+/, '~') }))

  return (
    <div className={'app' + (!state.sidebarOpen ? ' app--nosidebar' : '')}>
      {state.sidebarOpen && (
        <Sidebar
          state={state}
          onNew={() => void openPicker()}
          editingTerminalId={editingTerminalId}
          onTerminalEditDone={() => setEditingTerminalId(null)}
        />
      )}
      <main className="main">
        <TabBar state={state} />
        {state.activeTabId ? (
          <TerminalPane key={state.activeTabId} terminalId={state.activeTabId} settings={state.settings} keyFilter={keyFilter} />
        ) : (
          <div className="empty">
            <div className="empty__title">No terminal open</div>
            <div className="empty__hint">⌘T to create one, or pick one on the left.</div>
          </div>
        )}
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
