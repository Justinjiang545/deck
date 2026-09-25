import { chainSize, MIN_PANE_HEIGHT, MIN_PANE_WIDTH, type Dir } from '../../shared/layout'
import type { Layout } from '../../shared/state'

/**
 * True if splitting `leafId` in `dir` would push every pane in the resulting same-direction
 * chain below the minimum usable size (~200px wide / ~120px tall). Measures the leaf's current
 * on-screen rect (`.pane-slot[data-terminal-id]`) and, combined with `chainSize` (how many
 * panes already share that chain), estimates the post-rebalance size each pane would end up
 * with — the actual rebalance always lands here since main/store.ts rebalances every split.
 * Renderer-only: layout.ts stays pure/pixel-agnostic, this is the one place that needs to know
 * real container dimensions. Never blocks when the pane can't be measured (e.g. not yet mounted).
 */
export function splitWouldBeTooSmall(layout: Layout | null, leafId: string, dir: Dir): boolean {
  const el = document.querySelector<HTMLElement>(`.pane-slot[data-terminal-id="${CSS.escape(leafId)}"]`)
  if (!el) return false
  const rect = el.getBoundingClientRect()
  const n = chainSize(layout, leafId, dir)
  if (n <= 0) return false
  const total = (dir === 'h' ? rect.width : rect.height) * n
  const each = total / (n + 1)
  const min = dir === 'h' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
  return each < min
}
