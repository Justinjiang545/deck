import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { sortedFolders, sortedTerminals, terminalsInFolder, type AppState, type ThemeName } from '../../shared/state'
import FolderSection from './FolderSection'

const THEME_ORDER: ThemeName[] = ['graphite', 'ember', 'tide', 'paper']

interface Props {
  state: AppState
  onNew(): void
  editingTerminalId: string | null
  onTerminalEditDone(): void
}

export default function Sidebar({ state, onNew, editingTerminalId, onTerminalEditDone }: Props): JSX.Element {
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // Track whether an in-app row/folder drag is underway so Unfiled can appear as a drop
  // target even when it would otherwise be hidden (empty, with folders present).
  useEffect(() => {
    const onDragStart = (): void => setDragging(true)
    const onDragEnd = (): void => setDragging(false)
    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDragEnd)
    return () => {
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDragEnd)
    }
  }, [])

  const newFolder = (): void => {
    window.deck
      .createFolder('New folder')
      .then((id) => setEditingFolderId(id))
      .catch((err) => console.error('createFolder failed', err))
  }

  const folders = sortedFolders(state)
  const unfiled = terminalsInFolder(state, null)
  const totalTerminals = sortedTerminals(state).length

  const cycleTheme = (): void => {
    const i = THEME_ORDER.indexOf(state.settings.theme)
    const next = THEME_ORDER[(i + 1) % THEME_ORDER.length]!
    void window.deck.setTheme(next)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__drag" />
      <div className="sidebar__head">
        <div className="sidebar__title">
          <button className="sidebar__collapse" title="Minimize sidebar (⌘B)" aria-label="Minimize sidebar" onClick={() => void window.deck.setSidebar(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="2" fill="none" stroke="currentColor" /><path d="M5 2.5v9" stroke="currentColor" /><path d="M9 5.5 7.5 7 9 8.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="sidebar__brand">deck</span>
        </div>
        <div className="sidebar__actions">
          <button className="btn" onClick={onNew} title="New terminal (⌘T)">+ Terminal</button>
          <button className="btn" onClick={newFolder} title="New folder (⌘⇧N)">+ Folder</button>
          <button
            className="theme-swatch"
            onClick={cycleTheme}
            title={`Theme: ${state.settings.theme} (click to cycle)`}
          />
        </div>
      </div>
      <div className="sidebar__list">
        {folders.map((f) => (
          <FolderSection
            key={f.id}
            folder={f}
            terminals={terminalsInFolder(state, f.id)}
            state={state}
            selected={state.selectedFolderId === f.id}
            editingFolder={editingFolderId === f.id}
            onFolderEditDone={() => setEditingFolderId(null)}
            editingTerminalId={editingTerminalId}
            onTerminalEditDone={onTerminalEditDone}
          />
        ))}
        {totalTerminals > 0 && (unfiled.length > 0 || folders.length === 0 || dragging) && (
          <FolderSection
            folder={null}
            terminals={unfiled}
            state={state}
            selected={state.selectedFolderId === null}
            editingFolder={false}
            onFolderEditDone={() => {}}
            editingTerminalId={editingTerminalId}
            onTerminalEditDone={onTerminalEditDone}
          />
        )}
        {totalTerminals === 0 && <div className="sidebar__empty">No terminals. ⌘T to create one.</div>}
      </div>
    </aside>
  )
}
