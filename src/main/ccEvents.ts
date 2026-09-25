import type { Terminal } from '../shared/state'

/** The Claude Code hook events deck listens for (see hookInstall.ts). */
export const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification', 'SessionStart', 'SessionEnd'] as const
export type HookEventName = (typeof HOOK_EVENTS)[number]

export function isHookEventName(v: unknown): v is HookEventName {
  return typeof v === 'string' && (HOOK_EVENTS as readonly string[]).includes(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function sessionIdFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  return str(p['session_id']) ?? str(p['sessionId'])
}

const MAX_MESSAGE = 500

/** Best-effort last-assistant-message snippet from a Stop hook payload; shape isn't guaranteed, so try a few known fields. */
export function lastMessageFrom(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const p = payload as Record<string, unknown>
  const direct = str(p['last_assistant_message']) ?? str(p['message']) ?? str(p['transcript_tail'])
  if (direct) return direct.slice(0, MAX_MESSAGE)
  return undefined
}

/**
 * Pure event -> next `cc` state mapping. `visible` is true when this terminal is both the
 * focused/visible pane and the app window is focused — in that case a needs-you transition
 * does not mark itself unseen (the user is already looking at it).
 */
export function nextCc(prev: Terminal['cc'], event: HookEventName, payload: unknown, visible: boolean): Terminal['cc'] {
  const sessionId = sessionIdFrom(payload) ?? prev?.sessionId
  switch (event) {
    case 'SessionStart':
      return { sessionId, status: 'idle', unseen: false }
    case 'SessionEnd':
      return null
    case 'UserPromptSubmit':
      return { sessionId, status: 'working', unseen: false, lastMessage: prev?.lastMessage }
    case 'Stop':
      return { sessionId, status: 'needs-you', attention: 'done', unseen: !visible, lastMessage: lastMessageFrom(payload) ?? prev?.lastMessage }
    case 'Notification':
      return { sessionId, status: 'needs-you', attention: 'input', unseen: !visible, lastMessage: prev?.lastMessage }
  }
}
