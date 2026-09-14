import { vi } from 'vitest'
import type { Tmux } from '../src/main/tmux'
import type { PtySink } from '../src/main/pty'

// vi.mock is hoisted above imports, so anything it closes over must come from vi.hoisted().
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: spawnMock }))

const { PtyManager } = await import('../src/main/pty')

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function fakeProc(): { onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> } {
  return { onData: vi.fn(), onExit: vi.fn(), kill: vi.fn(), write: vi.fn(), resize: vi.fn() }
}

function fakeTmux(capturePane: (id: string) => Promise<string>): Tmux {
  return { opts: { bin: '/bin/tmux', conf: '/x/deck.conf' }, capturePane } as unknown as Tmux
}

function fakeSink(): PtySink {
  return { data: vi.fn(), exit: vi.fn() }
}

function procsOf(mgr: InstanceType<typeof PtyManager>): Map<string, unknown> {
  return (mgr as unknown as { procs: Map<string, unknown> }).procs
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('PtyManager generation guard', () => {
  it('two overlapping attach() calls for the same id: only the last one spawns and survives', async () => {
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const calls = [d1, d2]
    let i = 0
    const tmux = fakeTmux(() => calls[i++]!.promise)

    const procs: ReturnType<typeof fakeProc>[] = []
    spawnMock.mockImplementation(() => {
      const p = fakeProc()
      procs.push(p)
      return p
    })

    const mgr = new PtyManager(tmux, fakeSink())

    // Two overlapping calls, not awaited between — they interleave across the
    // internal detach() and capturePane() awaits.
    const p1 = mgr.attach('a', 80, 24)
    const p2 = mgr.attach('a', 80, 24)

    d1.resolve('')
    d2.resolve('')
    await Promise.all([p1, p2])

    // The superseded attempt must abort before spawning at all.
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(procsOf(mgr).size).toBe(1)
    expect(procsOf(mgr).get('a')).toBe(procs[0])
  })

  it('detach() called while an attach() is awaiting capturePane aborts that attach', async () => {
    const d = deferred<string>()
    const tmux = fakeTmux(() => d.promise)
    const mgr = new PtyManager(tmux, fakeSink())

    const p = mgr.attach('a', 80, 24)
    // Let attach() run past its internal detach() and reach the capturePane await.
    await Promise.resolve()
    await mgr.detach('a')

    d.resolve('')
    await p

    expect(spawnMock).not.toHaveBeenCalled()
    expect(procsOf(mgr).size).toBe(0)
  })
})
