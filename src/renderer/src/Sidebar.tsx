import { useState } from 'react'
import type { JSX } from 'react'
import { sortedFolders, sortedTerminals, terminalsInFolder, type AppState } from '../../shared/state'
import FolderSection from './FolderSection'

interface Props {
  state: AppState
  onNew(): void
  editingTerminalId: string | null
  onTerminalEditDone(): void
}

export default function Sidebar({ state, onNew, editingTerminalId, onTerminalEditDone }: Props): JSX.Element {
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)

  const newFolder = (): void => {
    window.deck
      .createFolder('New folder')
      .then((id) => setEditingFolderId(id))
      .catch((err) => console.error('createFolder failed', err))
  }

  const folders = sortedFolders(state)
  const unfiled = terminalsInFolder(state, null)

  return (
    <aside className="sidebar">
      <div className="sidebar__drag" />
      <div className="sidebar__head">
        <span className="sidebar__brand">deck</span>
        <div className="sidebar__actions">
          <button className="btn" onClick={onNew} title="New terminal (⌘T)">+ Terminal</button>
          <button className="btn" onClick={newFolder} title="New folder (⌘⇧N)">+ Folder</button>
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
        {(unfiled.length > 0 || folders.length === 0) && (
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
        {sortedTerminals(state).length === 0 && <div className="sidebar__empty">No terminals. ⌘T to create one.</div>}
      </div>
    </aside>
  )
}
