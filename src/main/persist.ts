import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState, Terminal } from '../shared/state'

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
    const openTabs = (raw.openTabs ?? []).filter((id) => terminals[id])
    const activeTabId = raw.activeTabId && openTabs.includes(raw.activeTabId) ? raw.activeTabId : null

    return {
      terminals,
      folders: raw.folders ?? {},
      openTabs,
      activeTabId,
      selectedFolderId: raw.selectedFolderId && (raw.folders ?? {})[raw.selectedFolderId] ? raw.selectedFolderId : null,
      layout: activeTabId ? { type: 'leaf', terminalId: activeTabId } : null,
      focusedTerminalId: activeTabId,
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
