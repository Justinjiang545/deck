import type { JSX } from 'react'
import { sortedTerminals, type AppState } from '../../shared/state'
import TerminalRow from './TerminalRow'

interface Props {
  state: AppState
  onNew(): void
}

export default function Sidebar({ state, onNew }: Props): JSX.Element {
  const shown = state.layout?.type === 'leaf' ? state.layout.terminalId : null
  return (
    <aside className="sidebar">
      <div className="sidebar__drag" />
      <div className="sidebar__head">
        <span className="sidebar__brand">deck</span>
        <button className="btn" onClick={onNew} title="New terminal (⌘T)">+ Terminal</button>
      </div>
      <div className="sidebar__list">
        {sortedTerminals(state).map((t) => (
          <TerminalRow
            key={t.id}
            terminal={t}
            active={t.id === shown}
            onShow={() => void window.deck.showTerminal(t.id)}
            onKill={() => void window.deck.killTerminal(t.id)}
            onRename={(title) => void window.deck.renameTerminal(t.id, title)}
          />
        ))}
        {sortedTerminals(state).length === 0 && <div className="sidebar__empty">No terminals. ⌘T to create one.</div>}
      </div>
    </aside>
  )
}
