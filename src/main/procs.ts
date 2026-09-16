import { execFile } from 'node:child_process'
import { SHELLS } from '../shared/state'
import { childEnv } from './tmux'

/**
 * Foreground detection via the tty's foreground process group.
 *
 * tmux's #{pane_current_command} reports the process-group *leader*, which for a
 * `claude` session is its bash wrapper — so an agent mid-tool-call looked like an idle
 * shell. The reliable signal is `tpgid` of the pane's root shell: if the foreground
 * group is not the root shell itself, something is running.
 */
export interface ProcInfo {
  pid: number
  pgid: number
  tpgid: number
  comm: string
}

export interface Foreground {
  fgCommand: string
  busy: boolean
}

export function parsePs(out: string): ProcInfo[] {
  const procs: ProcInfo[] = []
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/)
    if (!m) continue
    procs.push({ pid: Number(m[1]), pgid: Number(m[2]), tpgid: Number(m[3]), comm: m[4]!.trim() })
  }
  return procs
}

export function snapshotProcs(): Promise<ProcInfo[]> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,pgid=,tpgid=,comm='], { maxBuffer: 16 * 1024 * 1024, env: childEnv() }, (err, stdout) => {
      resolve(err ? [] : parsePs(String(stdout)))
    })
  })
}

/** `-zsh` → `zsh`, `/usr/local/bin/node` → `node`. */
export function commName(comm: string): string {
  const base = comm.split('/').pop() ?? comm
  return base.startsWith('-') ? base.slice(1) : base
}

export function resolveForeground(pane: { pid: number; fgCommand: string }, procs: ProcInfo[]): Foreground {
  const root = procs.find((p) => p.pid === pane.pid)
  if (!root) {
    // No process snapshot for this pane (race with a dying session): fall back to tmux's view.
    return { fgCommand: pane.fgCommand, busy: !SHELLS.has(pane.fgCommand) }
  }
  const busy = root.tpgid > 0 && root.tpgid !== root.pid
  if (!busy) return { fgCommand: commName(root.comm), busy: false }
  const group = procs.filter((p) => p.pgid === root.tpgid)
  if (group.some((p) => commName(p.comm) === 'claude')) return { fgCommand: 'claude', busy: true }
  const leader = group.find((p) => p.pid === root.tpgid)
  return { fgCommand: leader ? commName(leader.comm) : pane.fgCommand, busy: true }
}
