import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import type { Terminal } from '../shared/state'
import { isHookEventName, nextCc } from './ccEvents'
import type { Store } from './store'

export interface HooksServerDeps {
  store: Store
  socketPath: string
  /** True when this terminal is both the focused/visible pane and the app window is focused. */
  isVisible: (terminalId: string) => boolean
  /** Called after a hook produces a `cc` with unseen:true, so the caller can notify/badge. */
  onAttention?: (terminalId: string, cc: NonNullable<Terminal['cc']>) => void
  log?: (...args: unknown[]) => void
}

export interface HooksServerHandle {
  close(): void
}

/**
 * Unix socket the hook script (~/.deck/claude-hook.sh) POSTs one JSON line per event to:
 * {"term": "<terminal id>", "event": "<HookEventName>", "payload": <raw hook stdin json>}
 */
export function startHooksServer(deps: HooksServerDeps): HooksServerHandle {
  const { store, socketPath } = deps
  const log = deps.log ?? ((): void => {})

  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath) } catch (err) { log('[hooks-server] could not remove stale socket:', err) }
  }

  function handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: { term?: unknown; event?: unknown; payload?: unknown }
    try {
      msg = JSON.parse(trimmed) as typeof msg
    } catch {
      log('[hooks-server] bad line:', trimmed.slice(0, 200))
      return
    }
    const id = typeof msg.term === 'string' ? msg.term : null
    if (!id || !isHookEventName(msg.event)) return
    const t = store.state.terminals[id]
    if (!t) return
    const visible = deps.isVisible(id)
    const cc = nextCc(t.cc, msg.event, msg.payload, visible)
    store.dispatch({ type: 'SET_CC', id, cc })
    // Only alert on the transition into unseen (or a change of kind), not on every repeat event.
    if (cc?.unseen && (!t.cc?.unseen || t.cc.attention !== cc.attention)) deps.onAttention?.(id, cc)
  }

  const server: Server = createServer((socket: Socket) => {
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        handleLine(line)
      }
    })
    socket.on('error', (err) => log('[hooks-server] socket error:', err))
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log('[hooks-server] EADDRINUSE, removing stale socket and retrying')
      try { unlinkSync(socketPath) } catch { /* ignore */ }
      server.listen(socketPath)
    } else {
      log('[hooks-server] listen error:', err)
    }
  })
  server.listen(socketPath)

  return {
    close(): void {
      server.close()
      try { unlinkSync(socketPath) } catch { /* already gone */ }
    }
  }
}
