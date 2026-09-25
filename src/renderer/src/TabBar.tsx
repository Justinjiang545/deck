import { useState } from 'react'
import type { JSX } from 'react'
import { activityOf, ccVisualOf, representativeTerminal, titleOf, type AppState } from '../../shared/state'
import { countLeaves } from '../../shared/layout'

interface Props { state: AppState }

export default function TabBar({ state }: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const tabs = state.openTabs
    .map((tabId) => {
      const t = representativeTerminal(state, tabId)
      return t ? { tabId, t, count: countLeaves(state.layouts[tabId] ?? null) } : null
    })
    .filter((x): x is { tabId: string; t: NonNullable<typeof x>['t']; count: number } => !!x)

  const drop = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const at = state.openTabs.indexOf(targetId)
    const ids = state.openTabs.filter((id) => id !== dragId)
    ids.splice(at, 0, dragId)
    void window.deck.reorderTabs(ids)
  }

  const dropAtEnd = (): void => {
    if (!dragId) return
    const ids = state.openTabs.filter((id) => id !== dragId)
    ids.push(dragId)
    void window.deck.reorderTabs(ids)
  }

  return (
    <div className="tabbar">
      {tabs.map(({ tabId, t, count }, i) => {
        const cc = ccVisualOf(t)
        const unseen = !!t.cc?.unseen
        const dotClass = cc ? 'tab__dot tab__dot--cc-' + cc : 'tab__dot tab__dot--' + activityOf(t)
        const glyph = cc === 'done' ? '✓' : cc === 'input' ? '?' : ''
        return (
          <div
            key={tabId}
            className={'tab' + (tabId === state.activeTabId ? ' tab--active' : '') + (unseen ? ' tab--attn' : '')}
            draggable
            // Carries the tab's currently-representative terminal — for a single-pane tab
            // (the common case) that's the whole tab; for a multi-pane tab, dragging its chip
            // moves just that one (focused) pane, not the whole split tree.
            onDragStart={(e) => { setDragId(tabId); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('deck/terminal', t.id) }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
            onDrop={() => drop(tabId)}
            onClick={() => void window.deck.activateTab(tabId)}
            onAuxClick={(e) => { if (e.button === 1) void window.deck.closePane(tabId) }}
            onContextMenu={(e) => { e.preventDefault(); void window.deck.showRowMenu(t.id) }}
            title={`${titleOf(t)} — ⌘${i + 1}`}
          >
            <span className={dotClass}>{glyph}</span>
            {count > 1 && <span className="tab__count">⊞ {count}</span>}
            <span className="tab__title">{titleOf(t)}</span>
            <button className="tab__x" title="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); void window.deck.closePane(tabId) }}>×</button>
          </div>
        )
      })}
      <div
        className="tabbar__spacer"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={dropAtEnd}
      />
      {tabs.length > 1 && (
        <button
          className="tabbar__tile"
          title="Tile all (⌘⇧G)"
          onClick={() => void window.deck.tileTabs()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="6.2" height="6.2" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8.8" y="1" width="6.2" height="6.2" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1" y="8.8" width="6.2" height="6.2" rx="1" stroke="currentColor" strokeWidth="1.3" />
            <rect x="8.8" y="8.8" width="6.2" height="6.2" rx="1" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      )}
    </div>
  )
}
