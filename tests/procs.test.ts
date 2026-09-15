import { parsePs, commName, resolveForeground } from '../src/main/procs'

const PS = `
  100   100   100 -zsh
  200   200   250 -zsh
  250   250   250 bash
  251   250   250 claude
  300   300   310 /bin/zsh
  310   310   310 /usr/local/bin/node
  400   400   400 -zsh
  401   400   400 sleep
`

describe('parsePs / commName', () => {
  it('parses pid pgid tpgid comm and skips junk', () => {
    const p = parsePs(PS)
    expect(p.length).toBe(8)
    expect(p[1]).toEqual({ pid: 200, pgid: 200, tpgid: 250, comm: '-zsh' })
  })
  it('normalises command names', () => {
    expect(commName('-zsh')).toBe('zsh')
    expect(commName('/usr/local/bin/node')).toBe('node')
    expect(commName('claude')).toBe('claude')
  })
})

describe('resolveForeground', () => {
  const procs = parsePs(PS)
  it('idle when the root shell owns the tty foreground', () => {
    expect(resolveForeground({ pid: 100, fgCommand: 'zsh' }, procs)).toEqual({ fgCommand: 'zsh', busy: false })
  })
  it('claude when a claude process is in the foreground group (even behind a bash wrapper)', () => {
    expect(resolveForeground({ pid: 200, fgCommand: 'bash' }, procs)).toEqual({ fgCommand: 'claude', busy: true })
  })
  it('busy with the group leader name for any other foreground job', () => {
    expect(resolveForeground({ pid: 300, fgCommand: 'node' }, procs)).toEqual({ fgCommand: 'node', busy: true })
  })
  it('a child in the same group as the root shell (no job control) counts as idle', () => {
    // tpgid == root pid: the shell is still the foreground group (e.g. `sleep` run without a new pgrp)
    expect(resolveForeground({ pid: 400, fgCommand: 'sleep' }, procs)).toEqual({ fgCommand: 'zsh', busy: false })
  })
  it('falls back to tmux view when the pane pid is missing from the snapshot', () => {
    expect(resolveForeground({ pid: 999, fgCommand: 'vim' }, procs)).toEqual({ fgCommand: 'vim', busy: true })
    expect(resolveForeground({ pid: 999, fgCommand: 'zsh' }, procs)).toEqual({ fgCommand: 'zsh', busy: false })
  })
})
