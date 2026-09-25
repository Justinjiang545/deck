import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState, Layout, Terminal } from '../shared/state'
import { leaves, removeLeaf } from '../shared/layout'

/** Drop any leaf whose terminal doesn't exist any more, collapsing the tree as it goes. */
function pruneLayout(layout: Layout, terminals: Record<string, Terminal>): Layout | null {
  let next: Layout | null = layout
  for (const id of leaves(layout)) {
    if (!terminals[id]) next = next && removeLeaf(next, id)
  }
  return next
}

export function loadState(file: string, fallback: AppState): AppState {
  if (!existsSync(file)) return fallback
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppState>
    if (!raw || typeof raw !== 'object' || typeof raw.terminals !== 'object') throw new Error('bad shape')

    const terminals: Record<string, Terminal> = {}
    for (const [id, t] of Object.entries(raw.terminals ?? {})) {
      if (t.folderId && !(raw.folders ?? {})[t.folderId]) {
        const { folderId: _, ...rest } = t
        terminals[id] = rest
      } else {
        terminals[id] = t
      }
    }

    // A tab id is only meaningful if we still know a layout for it referencing at least one
    // live terminal — the pre-splits shape (openTabs entries === terminal ids) is a special
    // case of this where layouts[id] is absent, so synthesize the single-leaf layout it implies.
    const rawLayouts = (raw.layouts ?? {}) as Record<string, Layout>
    const openTabs: string[] = []
    const layouts: Record<string, Layout> = {}
    for (const id of raw.openTabs ?? []) {
      const source = rawLayouts[id] ?? (terminals[id] ? ({ type: 'leaf', terminalId: id } as Layout) : null)
      const pruned = source ? pruneLayout(source, terminals) : null
      if (pruned) {
        openTabs.push(id)
        layouts[id] = pruned
      }
    }

    const rawTabFocus = (raw.tabFocus ?? {}) as Record<string, string>
    const tabFocus: Record<string, string> = {}
    for (const [tabId, focusId] of Object.entries(rawTabFocus)) {
      if (layouts[tabId] && leaves(layouts[tabId]).includes(focusId)) tabFocus[tabId] = focusId
    }

    const activeTabId = raw.activeTabId && openTabs.includes(raw.activeTabId) ? raw.activeTabId : null
    const activeLayout = activeTabId ? (layouts[activeTabId] ?? null) : null
    const activeLeaves = leaves(activeLayout)
    const rememberedFocus = activeTabId ? tabFocus[activeTabId] : undefined
    const focusedTerminalId = activeTabId
      ? ((rememberedFocus && activeLeaves.includes(rememberedFocus) ? rememberedFocus : activeLeaves[0]) ?? null)
      : null

    return {
      terminals,
      folders: raw.folders ?? {},
      openTabs,
      activeTabId,
      layouts,
      tabFocus,
      selectedFolderId: raw.selectedFolderId && (raw.folders ?? {})[raw.selectedFolderId] ? raw.selectedFolderId : null,
      layout: activeLayout,
      focusedTerminalId,
      sidebarOpen: raw.sidebarOpen ?? true,
      settings: { ...fallback.settings, ...(raw.settings ?? {}) }
    }
  } catch {
    try { renameSync(file, file + '.bak') } catch { /* ignore */ }
    return fallback
  }
}

export function saveStateNow(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

export function createSaver(file: string, delayMs = 500): { schedule(state: AppState): void; flush(): void } {
  let pending: AppState | null = null
  let timer: NodeJS.Timeout | null = null
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    if (pending) { saveStateNow(file, pending); pending = null }
  }
  return {
    schedule(state) {
      pending = state
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
