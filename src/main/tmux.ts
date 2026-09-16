import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export const SOCKET = 'deck'
export const SESSION_PREFIX = 'deck-'
/**
 * Printable separator: without a UTF-8 locale (Dock/Spotlight launches have no LANG) tmux
 * rewrites control characters in its output as '_', which silently destroyed tab-separated
 * lines. The path goes last because it is the only field that may itself contain '|'.
 */
export const LIST_SEP = '|'
export const LIST_FORMAT = ['#{session_name}', '#{pane_pid}', '#{pane_current_command}', '#{pane_current_path}'].join(LIST_SEP)

export function sessionName(id: string): string {
  return SESSION_PREFIX + id
}

export function idFromSession(name: string): string | null {
  return name.startsWith(SESSION_PREFIX) ? name.slice(SESSION_PREFIX.length) : null
}

const FALLBACK_BINS = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']

export function findTmux(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, 'tmux')
    if (existsSync(p)) return p
  }
  for (const p of FALLBACK_BINS) if (existsSync(p)) return p
  return null
}

export interface TmuxOpts {
  bin: string
  conf: string
  socket?: string
}

export function baseArgs(o: TmuxOpts): string[] {
  // -u: treat the client as UTF-8 regardless of locale, so output is never sanitized.
  return ['-u', '-L', o.socket ?? SOCKET, '-f', o.conf]
}

export function newSessionArgs(o: TmuxOpts, id: string, cwd: string): string[] {
  return [...baseArgs(o), 'new-session', '-d', '-s', sessionName(id), '-c', cwd, '-e', `DECK_TERM_ID=${id}`]
}

export function killSessionArgs(o: TmuxOpts, id: string): string[] {
  return [...baseArgs(o), 'kill-session', '-t', '=' + sessionName(id)]
}

export function attachArgs(o: TmuxOpts, id: string): string[] {
  return [...baseArgs(o), 'attach-session', '-t', '=' + sessionName(id)]
}

export function capturePaneArgs(o: TmuxOpts, id: string): string[] {
  // pane-level target: plain "=session" (no trailing ":") is rejected by
  // tmux 3.6a for pane-level commands ("can't find pane: =session"), and a
  // bare session name is subject to tmux's prefix matching — if the exact
  // session is gone but another session's name starts with the same
  // string, the command silently lands in the wrong session instead of
  // failing. "=session:" (exact session + default window) resolves the
  // pane unambiguously and fails cleanly ("can't find session: ...") when
  // the exact session doesn't exist.
  return [...baseArgs(o), 'capture-pane', '-p', '-e', '-J', '-S', '-', '-E', '-1', '-t', '=' + sessionName(id) + ':']
}

export function listPanesArgs(o: TmuxOpts): string[] {
  return [...baseArgs(o), 'list-panes', '-a', '-F', LIST_FORMAT]
}

export function sendKeysArgs(o: TmuxOpts, id: string, text: string): string[] {
  // see capturePaneArgs: exact session match, no prefix-matching risk.
  return [...baseArgs(o), 'send-keys', '-t', '=' + sessionName(id) + ':', text, 'Enter']
}

export interface PaneInfo {
  id: string
  pid: number
  cwd: string
  fgCommand: string
  busy?: boolean
}

export function parseListPanes(out: string): PaneInfo[] {
  const panes: PaneInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(LIST_SEP)
    if (parts.length < 4) continue
    const [name = '', pidStr = '', fgCommand = ''] = parts
    const cwd = parts.slice(3).join(LIST_SEP)
    const id = idFromSession(name)
    const pid = Number(pidStr)
    // Refuse anything malformed: a bad line must never become a phantom terminal.
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !Number.isInteger(pid) || pid <= 0) continue
    panes.push({ id, pid, cwd, fgCommand })
  }
  return panes
}

/** Environment for every tmux/ps child: guarantee a UTF-8 locale even when launched from the Dock. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  if (!/utf-?8/i.test(env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? '')) env['LANG'] = 'en_US.UTF-8'
  return env
}

export function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, env: childEnv() }, (err, stdout, stderr) => {
      const c = (err as { code?: unknown } | null)?.code
      const code = typeof c === 'number' ? c : err ? 1 : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export class Tmux {
  constructor(private o: TmuxOpts) {}

  private async exec(args: string[]): Promise<string> {
    const r = await run(this.o.bin, args)
    if (r.code !== 0) throw new Error(`tmux ${args.slice(4).join(' ')} failed (${r.code}): ${r.stderr.trim()}`)
    return r.stdout
  }

  get opts(): TmuxOpts {
    return this.o
  }

  async newSession(id: string, cwd: string): Promise<void> {
    await this.exec(newSessionArgs(this.o, id, cwd))
  }

  async kill(id: string): Promise<void> {
    await this.exec(killSessionArgs(this.o, id))
  }

  /**
   * Panes on the deck server. Resolves [] only when the server is genuinely not running;
   * any other failure throws so a poll tick is skipped rather than read as "no terminals".
   */
  async listPanes(): Promise<PaneInfo[]> {
    const r = await run(this.o.bin, listPanesArgs(this.o))
    if (r.code !== 0) {
      if (/no server running|No such file or directory/.test(r.stderr)) return []
      throw new Error(`tmux list-panes failed (${r.code}): ${r.stderr.trim()}`)
    }
    return parseListPanes(r.stdout)
  }

  async capturePane(id: string): Promise<string> {
    const r = await run(this.o.bin, capturePaneArgs(this.o, id))
    return r.code === 0 ? r.stdout : ''
  }

  async sendKeys(id: string, text: string): Promise<void> {
    await this.exec(sendKeysArgs(this.o, id, text))
  }

  async hasServer(): Promise<boolean> {
    const r = await run(this.o.bin, [...baseArgs(this.o), 'list-sessions'])
    return r.code === 0
  }

  async killServer(): Promise<void> {
    await run(this.o.bin, [...baseArgs(this.o), 'kill-server'])
  }
}
