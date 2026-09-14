import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { titleOf, type Terminal } from '../../shared/state'

interface Props {
  terminal: Terminal
  active: boolean
  onShow(): void
  onKill(): void
  onRename(title: string | null): void
}

export default function TerminalRow({ terminal, active, onShow, onKill, onRename }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  const committed = useRef(false)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const startEdit = (): void => {
    setDraft(terminal.customTitle ?? titleOf(terminal))
    cancelled.current = false
    committed.current = false
    setEditing(true)
  }
  const commit = (): void => {
    setEditing(false)
    if (cancelled.current || committed.current) { cancelled.current = false; committed.current = false; return }
    committed.current = true
    onRename(draft.trim() || null)
  }

  return (
    <div
      className={'row' + (active ? ' row--active' : '')}
      onClick={onShow}
      onDoubleClick={(e) => { e.stopPropagation(); startEdit() }}
      title={terminal.cwd}
    >
      <span className={'row__dot' + (terminal.fgCommand === 'claude' ? ' row__dot--claude' : '')} />
      {editing ? (
        <input
          ref={inputRef}
          className="row__input"
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
        <span className="row__title">{titleOf(terminal)}</span>
      )}
      <span className="row__sub">{terminal.fgCommand !== 'zsh' && terminal.customTitle ? terminal.fgCommand : ''}</span>
      <button className="row__x" title="Kill terminal" onClick={(e) => { e.stopPropagation(); onKill() }}>×</button>
    </div>
  )
}
