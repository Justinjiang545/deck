import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { HOOK_EVENTS, type HookEventName } from './ccEvents'

/** Marks a hook command string as deck's own, so a re-install can find/replace it without touching anyone else's hooks. */
export const DECK_HOOK_MARKER = '# deck-hook'

export function deckHookCommand(scriptPath: string, event: HookEventName): string {
  return `${scriptPath} ${event} ${DECK_HOOK_MARKER}`
}

/** The POSIX sh hook script written to ~/.deck/claude-hook.sh. Always exits 0; never blocks Claude Code. */
export const HOOK_SCRIPT = `#!/bin/sh
# Written by deck (Electron terminal manager) — reports Claude Code hook events to deck's
# unix socket so the sidebar can show live "is the agent working / done / waiting" status.
# Safe to delete; deck rewrites it on next launch. Never blocks Claude Code: always exits 0.
EVENT="\${1:-unknown}"

if [ -z "\${DECK_HOOK_SOCK:-}" ] || [ -z "\${DECK_TERM_ID:-}" ]; then
  exit 0
fi

# Flatten to one line: the socket protocol is line-delimited, and JSON strings can't hold raw newlines.
PAYLOAD="$(cat 2>/dev/null | tr -d '\\n\\r')"
if [ -z "$PAYLOAD" ]; then
  PAYLOAD="null"
fi

LINE="{\\"term\\":\\"$DECK_TERM_ID\\",\\"event\\":\\"$EVENT\\",\\"payload\\":$PAYLOAD}"

if command -v nc >/dev/null 2>&1; then
  printf '%s\\n' "$LINE" | nc -U -w 1 "$DECK_HOOK_SOCK" >/dev/null 2>&1
fi

exit 0
`

/** Idempotent: writes the script only if the path is missing or its content differs. Always chmod 755 after. */
export function writeHookScript(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current !== HOOK_SCRIPT) writeFileSync(path, HOOK_SCRIPT)
  chmodSync(path, 0o755)
}

interface HookEntry { type: string; command: string; timeout?: number }
interface HookGroup { matcher?: string; hooks: HookEntry[] }
type HooksMap = Record<string, HookGroup[] | undefined>
export interface ClaudeSettings {
  hooks?: HooksMap
  [key: string]: unknown
}

/** Pure: merges deck's hook entries into a parsed settings.json, preserving every existing hook/key. Idempotent. */
export function mergeHooks(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  const hooks: HooksMap = { ...(settings.hooks ?? {}) }
  for (const event of HOOK_EVENTS) {
    const existing = (hooks[event] ?? []).filter((g) => !g.hooks.every((h) => h.command.includes(DECK_HOOK_MARKER)))
    const deckGroup: HookGroup = { matcher: '*', hooks: [{ type: 'command', command: deckHookCommand(scriptPath, event), timeout: 3 }] }
    hooks[event] = [...existing, deckGroup]
  }
  return { ...settings, hooks }
}

export interface InstallResult {
  installed: boolean
  reason?: string
}

/**
 * Idempotent merge into settings.json. Backs up the original (once, ever) before the first
 * write. Never writes if the file fails to parse. Atomic write (tmp + rename).
 */
export function installHooks(settingsPath: string, scriptPath: string): InstallResult {
  let raw = '{}'
  if (existsSync(settingsPath)) {
    try {
      raw = readFileSync(settingsPath, 'utf8')
    } catch (err) {
      return { installed: false, reason: `read failed: ${String(err)}` }
    }
  }
  let parsed: ClaudeSettings
  try {
    parsed = JSON.parse(raw) as ClaudeSettings
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  } catch (err) {
    return { installed: false, reason: `parse failed, left untouched: ${String(err)}` }
  }

  const merged = mergeHooks(parsed, scriptPath)
  if (JSON.stringify(merged) === JSON.stringify(parsed)) return { installed: true } // already up to date

  const backupPath = settingsPath + '.deck-backup'
  if (existsSync(settingsPath) && !existsSync(backupPath)) {
    try { copyFileSync(settingsPath, backupPath) } catch { /* best effort */ }
  }

  mkdirSync(dirname(settingsPath), { recursive: true })
  const tmp = settingsPath + '.tmp'
  writeFileSync(tmp, JSON.stringify(merged, null, 2))
  renameSync(tmp, settingsPath)
  return { installed: true }
}
