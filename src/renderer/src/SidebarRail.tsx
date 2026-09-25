import type { JSX } from 'react'
import { activityOf, ccVisualOf, sortedTerminals, titleOf, type AppState } from '../../shared/state'
import { leaves } from '../../shared/layout'

interface Props {
  state: AppState
  onNew(): void
}

/**
 * Minimized sidebar (⌘B): one status dot per terminal so a finished/waiting agent is still
 * visible at a glance, plus expand and new-terminal buttons. Click a dot to show that terminal.
 */
export default function SidebarRail({ state, onNew }: Props): JSX.Element {
  const visible = new Set(leaves(state.layout))
  return (
    <aside className="rail">
      <div className="rail__drag" />
      <button className="rail__btn" title="Expand sidebar (⌘B)" aria-label="Expand sidebar" onClick={() => void window.deck.setSidebar(true)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="2" fill="none" stroke="currentColor" /><path d="M5 2.5v9" stroke="currentColor" /><path d="M7.5 5.5 9 7l-1.5 1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button className="rail__btn" title="New terminal (⌘T)" aria-label="New terminal" onClick={onNew}>+</button>
      <div className="rail__list">
        {sortedTerminals(state).map((t) => {
          const cc = ccVisualOf(t)
          const glyph = cc === 'done' ? '✓' : cc === 'input' ? '?' : ''
          const status = cc === 'done' ? ' — done' : cc === 'input' ? ' — needs input' : cc === 'working' ? ' — working' : ''
          return (
            <button
              key={t.id}
              className={'rail__item' + (t.id === state.focusedTerminalId ? ' rail__item--active' : visible.has(t.id) ? ' rail__item--visible' : '') + (t.cc?.unseen ? ' rail__item--attn' : '')}
              title={titleOf(t) + status}
              aria-label={titleOf(t) + status}
              onClick={() => void window.deck.showTerminal(t.id)}
              onContextMenu={(e) => { e.preventDefault(); void window.deck.showRowMenu(t.id) }}
            >
              <span className={cc ? 'row__dot row__dot--cc-' + cc : 'row__dot row__dot--' + activityOf(t)}>{glyph}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
