import * as pty from 'node-pty'
import { homedir } from 'node:os'
import { attachArgs, type Tmux } from './tmux'

export interface PtySink {
  data(id: string, data: string): void
  exit(id: string): void
}

/** One node-pty per visible terminal, each running `tmux attach` to that terminal's session. */
export class PtyManager {
  private procs = new Map<string, pty.IPty>()
  // Per-id generation counter: guards against overlapping attach() calls for the same id
  // (e.g. a fast show/hide/show, or a double-invoke from the renderer) racing across the
  // awaits below and leaking a live `tmux attach` client. Bumped by both attach() and
  // detach() so any in-flight attach becomes stale the moment a newer attach/detach starts.
  private gen = new Map<string, number>()

  constructor(private tmux: Tmux, private sink: PtySink) {}

  async attach(id: string, cols: number, rows: number): Promise<void> {
    await this.detach(id)
    const g = (this.gen.get(id) ?? 0) + 1
    this.gen.set(id, g)
    // Pre-fill scrollback with history (everything above the visible screen).
    const history = await this.tmux.capturePane(id)
    if (this.gen.get(id) !== g) return // superseded by a newer attach()/detach() while awaiting capturePane
    if (history) {
      this.sink.data(id, history.replace(/\n+$/, '').replace(/\n/g, '\r\n'))
      // Clear screen + home the cursor so tmux's own redraw lands on a clean viewport.
      this.sink.data(id, '\x1b[2J\x1b[H')
    }
    const o = this.tmux.opts
    const proc = pty.spawn(o.bin, attachArgs(o, id), {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(1, rows),
      cwd: homedir(),
      env: { ...process.env, TERM: 'xterm-256color', LANG: process.env['LANG'] ?? 'en_US.UTF-8' }
    })
    if (this.gen.get(id) !== g) {
      // Superseded between the capturePane check and spawning: don't keep this proc around.
      try { proc.kill() } catch { /* already gone */ }
      return
    }
    this.procs.set(id, proc)
    proc.onData((d) => this.sink.data(id, d))
    proc.onExit(() => {
      if (this.procs.get(id) === proc) {
        this.procs.delete(id)
        this.sink.exit(id)
      }
    })
  }

  async detach(id: string): Promise<void> {
    this.gen.set(id, (this.gen.get(id) ?? 0) + 1) // abort any attach() in flight for this id
    const proc = this.procs.get(id)
    if (!proc) return
    this.procs.delete(id)
    try { proc.kill() } catch { /* already gone */ }
  }

  write(id: string, data: string): void {
    this.procs.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try { this.procs.get(id)?.resize(Math.max(2, cols), Math.max(1, rows)) } catch { /* proc exiting */ }
  }

  detachAll(): void {
    for (const id of [...this.procs.keys()]) void this.detach(id)
  }
}
