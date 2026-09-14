import { useEffect, useRef, useState } from 'react'
import type { DragEvent, JSX } from 'react'
import { sortedFolders, type AppState, type Folder, type Terminal } from '../../shared/state'
import TerminalRow from './TerminalRow'

interface Props {
  folder: Folder | null // null = Unfiled
  terminals: Terminal[]
  state: AppState
  selected: boolean
  editingFolder: boolean
  onFolderEditDone(): void
  editingTerminalId: string | null
  onTerminalEditDone(): void
}

export default function FolderSection({
  folder,
  terminals,
  state,
  selected,
  editingFolder,
  onFolderEditDone,
  editingTerminalId,
  onTerminalEditDone
}: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [overCount, setOverCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  const committed = useRef(false)

  useEffect(() => { if (inputRef.current) inputRef.current.select() }, [editing])

  // A drag that ends outside this section (dropped elsewhere, or cancelled) never fires
  // dragLeave here, so the enter/leave counter can get stuck positive — clear it globally.
  useEffect(() => {
    const reset = (): void => setOverCount(0)
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    return () => {
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
    }
  }, [])

  const startEdit = (): void => {
    if (!folder) return
    setDraft(folder.name)
    cancelled.current = false
    committed.current = false
    setEditing(true)
  }

  // Sidebar puts a freshly created folder straight into rename mode.
  useEffect(() => { if (editingFolder) startEdit() }, [editingFolder])

  const commit = (): void => {
    setEditing(false)
    onFolderEditDone()
    if (cancelled.current || committed.current) { cancelled.current = false; committed.current = false; return }
    committed.current = true
    if (folder) {
      const name = draft.trim()
      if (name) void window.deck.renameFolder(folder.id, name)
    }
  }

  const shown = state.layout?.type === 'leaf' ? state.layout.terminalId : null
  const collapsed = folder?.collapsed ?? false

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setOverCount(0)
    const termId = e.dataTransfer.getData('deck/terminal')
    if (termId) { void window.deck.moveTerminal(termId, folder?.id ?? null); return }
    const draggedFolderId = e.dataTransfer.getData('deck/folder')
    if (draggedFolderId && folder && draggedFolderId !== folder.id) {
      const ids = sortedFolders(state).map((f) => f.id).filter((id) => id !== draggedFolderId)
      ids.splice(ids.indexOf(folder.id), 0, draggedFolderId)
      void window.deck.reorderFolders(ids)
    }
  }

  return (
    <div
      className={
        'folder' +
        (collapsed ? ' folder--collapsed' : '') +
        (selected ? ' folder--selected' : '') +
        (overCount > 0 ? ' folder--over' : '')
      }
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => { e.preventDefault(); setOverCount((n) => n + 1) }}
      onDragLeave={() => setOverCount((n) => Math.max(0, n - 1))}
      onDrop={onDrop}
    >
      <div
        className="folder__head"
        draggable={!!folder}
        onDragStart={(e) => { if (folder) e.dataTransfer.setData('deck/folder', folder.id) }}
        onClick={() => void window.deck.selectFolder(folder?.id ?? null)}
        onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
      >
        {folder && (
          <button
            className="folder__chev"
            onClick={(e) => { e.stopPropagation(); void window.deck.setFolderCollapsed(folder.id, !folder.collapsed) }}
          >
            ▾
          </button>
        )}
        {editing ? (
          <input
            ref={inputRef}
            className="folder__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { cancelled.current = true; setEditing(false) }
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="folder__name">{folder ? folder.name : 'Unfiled'}</span>
        )}
        <span className="folder__count">{terminals.length}</span>
        {folder && (
          <button
            className="folder__x"
            title="Delete folder"
            onClick={(e) => { e.stopPropagation(); void window.deck.deleteFolder(folder.id) }}
          >
            ×
          </button>
        )}
      </div>
      {!collapsed &&
        terminals.map((t) => (
          <TerminalRow
            key={t.id}
            terminal={t}
            active={t.id === shown}
            open={state.openTabs.includes(t.id)}
            forceEdit={editingTerminalId === t.id}
            onEditDone={onTerminalEditDone}
            onShow={() => void window.deck.showTerminal(t.id)}
            onKill={() => void window.deck.killTerminal(t.id)}
            onRename={(title) => void window.deck.renameTerminal(t.id, title)}
          />
        ))}
    </div>
  )
}
