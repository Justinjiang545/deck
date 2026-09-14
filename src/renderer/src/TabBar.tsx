import { useState } from 'react'
import type { JSX } from 'react'
import { titleOf, type AppState } from '../../shared/state'

interface Props { state: AppState }

export default function TabBar({ state }: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const tabs = state.openTabs.map((id) => state.terminals[id]).filter((t): t is NonNullable<typeof t> => !!t)

  const drop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = state.openTabs.filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void window.deck.reorderTabs(ids)
  }

  return (
    <div className="tabbar">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={'tab' + (t.id === state.activeTabId ? ' tab--active' : '')}
          draggable
          onDragStart={() => setDragId(t.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(t.id)}
          onClick={() => void window.deck.showTerminal(t.id)}
          onAuxClick={(e) => { if (e.button === 1) void window.deck.closePane(t.id) }}
          title={`${titleOf(t)} — ⌘${i + 1}`}
        >
          <span className={'tab__dot' + (t.fgCommand === 'claude' ? ' tab__dot--claude' : '')} />
          <span className="tab__title">{titleOf(t)}</span>
          <button className="tab__x" title="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); void window.deck.closePane(t.id) }}>×</button>
        </div>
      ))}
      <div className="tabbar__spacer" />
    </div>
  )
}
