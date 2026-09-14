import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useAppState } from './useAppState'
import Sidebar from './Sidebar'
import TerminalPane from './TerminalPane'
import Palette, { type PaletteItem } from './Palette'
import type { ProjectEntry } from '../../shared/ipc'

export default function App(): JSX.Element {
  const state = useAppState()
  const [picker, setPicker] = useState<ProjectEntry[] | null>(null)

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

  const shown = state?.layout?.type === 'leaf' ? state.layout.terminalId : null

  // Global shortcuts. Returns true if handled.
  const handleKey = useCallback((e: KeyboardEvent): boolean => {
    if (!e.metaKey || e.ctrlKey || e.altKey) return false
    const k = e.key.toLowerCase()
    if (k === 't' && !e.shiftKey) { void openPicker(); return true }
    if (k === 'b' && !e.shiftKey) { if (state) void window.deck.setSidebar(!state.sidebarOpen); return true }
    if (k === 'w') {
      if (!shown) return true
      if (e.shiftKey) void window.deck.killTerminal(shown)
      else void window.deck.closePane(shown)
      return true
    }
    return false
  }, [openPicker, state, shown])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (handleKey(e)) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleKey])

  // xterm sees keys first; let the app own our shortcuts, pass everything else through.
  const keyFilter = useCallback((e: KeyboardEvent): boolean => {
    if (e.type !== 'keydown') return true
    if (!e.metaKey || e.ctrlKey || e.altKey) return true
    const k = e.key.toLowerCase()
    if ((k === 't' || k === 'b') && !e.shiftKey) return false
    if (k === 'w') return false
    return true
  }, [])

  if (!state) return <div className="app" />

  const items: PaletteItem[] = (picker ?? []).map((p) => ({ id: p.path, label: p.name, detail: p.path.replace(/^\/Users\/[^/]+/, '~') }))

  return (
    <div className="app">
      {state.sidebarOpen && <Sidebar state={state} onNew={() => void openPicker()} />}
      <main className="main">
        {!state.sidebarOpen && <div className="main__drag" />}
        {shown ? (
          <TerminalPane key={shown} terminalId={shown} settings={state.settings} keyFilter={keyFilter} />
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
