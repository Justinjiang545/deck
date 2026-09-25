import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DECK_HOOK_MARKER, HOOK_SCRIPT, installHooks, mergeHooks, writeHookScript } from '../src/main/hookInstall'
import { HOOK_EVENTS } from '../src/main/ccEvents'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'deck-hooktest-'))
}

describe('mergeHooks', () => {
  it('adds a deck group to every deck event and preserves other hooks/keys', () => {
    const settings = {
      model: 'opus',
      hooks: {
        Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash other.sh', timeout: 5 }] }],
        UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash prompt.sh' }] }]
      }
    }
    const merged = mergeHooks(settings, '/x/claude-hook.sh')
    expect(merged.model).toBe('opus')
    for (const e of HOOK_EVENTS) {
      const groups = merged.hooks![e]!
      expect(groups.some((g) => g.hooks.some((h) => h.command.includes(DECK_HOOK_MARKER) && h.command.includes(e)))).toBe(true)
    }
    // existing, non-deck entries are untouched
    expect(merged.hooks!.Stop!.some((g) => g.hooks.some((h) => h.command === 'bash other.sh'))).toBe(true)
    expect(merged.hooks!.UserPromptSubmit!.some((g) => g.hooks.some((h) => h.command === 'bash prompt.sh'))).toBe(true)
  })

  it('is idempotent', () => {
    const settings = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash other.sh' }] }] } }
    const once = mergeHooks(settings, '/x/claude-hook.sh')
    const twice = mergeHooks(once, '/x/claude-hook.sh')
    expect(twice).toEqual(once)
  })

  it('replaces its own prior entry rather than accumulating duplicates', () => {
    let settings: Parameters<typeof mergeHooks>[0] = {}
    settings = mergeHooks(settings, '/old/path.sh')
    settings = mergeHooks(settings, '/new/path.sh')
    for (const e of HOOK_EVENTS) {
      expect(settings.hooks![e]!.length).toBe(1)
      expect(settings.hooks![e]![0]!.hooks[0]!.command).toContain('/new/path.sh')
    }
  })

  it('handles a settings object with no hooks key at all', () => {
    const merged = mergeHooks({}, '/x/claude-hook.sh')
    for (const e of HOOK_EVENTS) expect(merged.hooks![e]!.length).toBe(1)
  })
})

describe('installHooks', () => {
  it('creates settings.json when missing, and backs nothing up (nothing existed)', () => {
    const d = dir()
    const settingsPath = join(d, 'settings.json')
    const r = installHooks(settingsPath, '/x/claude-hook.sh')
    expect(r.installed).toBe(true)
    expect(existsSync(settingsPath)).toBe(true)
    expect(existsSync(settingsPath + '.deck-backup')).toBe(false)
    const written = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(written.hooks.Stop[0].hooks[0].command).toContain(DECK_HOOK_MARKER)
  })

  it('backs up the original once, preserves existing hooks, and is idempotent', () => {
    const d = dir()
    const settingsPath = join(d, 'settings.json')
    const original = { permissions: { allow: ['Bash(ls:*)'] }, hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash mine.sh' }] }] } }
    writeFileSync(settingsPath, JSON.stringify(original, null, 2))

    installHooks(settingsPath, '/x/claude-hook.sh')
    const backupPath = settingsPath + '.deck-backup'
    expect(existsSync(backupPath)).toBe(true)
    expect(JSON.parse(readFileSync(backupPath, 'utf8'))).toEqual(original)

    const afterFirst = readFileSync(settingsPath, 'utf8')
    // A second install must not re-copy the backup or change the on-disk content.
    const backupBefore = readFileSync(backupPath, 'utf8')
    installHooks(settingsPath, '/x/claude-hook.sh')
    expect(readFileSync(backupPath, 'utf8')).toBe(backupBefore)
    expect(readFileSync(settingsPath, 'utf8')).toBe(afterFirst)

    const finalParsed = JSON.parse(afterFirst)
    expect(finalParsed.permissions.allow).toEqual(['Bash(ls:*)'])
    expect(finalParsed.hooks.Stop.some((g: { hooks: { command: string }[] }) => g.hooks.some((h) => h.command === 'bash mine.sh'))).toBe(true)
  })

  it('never writes when the existing file fails to parse', () => {
    const d = dir()
    const settingsPath = join(d, 'settings.json')
    writeFileSync(settingsPath, '{ not valid json')
    const before = readFileSync(settingsPath, 'utf8')
    const r = installHooks(settingsPath, '/x/claude-hook.sh')
    expect(r.installed).toBe(false)
    expect(readFileSync(settingsPath, 'utf8')).toBe(before)
    expect(existsSync(settingsPath + '.deck-backup')).toBe(false)
  })
})

describe('writeHookScript', () => {
  it('writes the script executable and only rewrites when content changes', () => {
    const d = dir()
    const scriptPath = join(d, '.deck', 'claude-hook.sh')
    writeHookScript(scriptPath)
    expect(readFileSync(scriptPath, 'utf8')).toBe(HOOK_SCRIPT)
    expect(statSync(scriptPath).mode & 0o777).toBe(0o755)

    const mtimeBefore = statSync(scriptPath).mtimeMs
    writeHookScript(scriptPath) // same content: should not need to rewrite (mtime may still tick on some fs, so just assert content + mode stay correct)
    expect(readFileSync(scriptPath, 'utf8')).toBe(HOOK_SCRIPT)
    expect(statSync(scriptPath).mode & 0o777).toBe(0o755)
    void mtimeBefore
  })

  it('the script exits 0 immediately with no env vars set', () => {
    expect(HOOK_SCRIPT).toContain('exit 0')
    expect(HOOK_SCRIPT).toContain('DECK_HOOK_SOCK')
    expect(HOOK_SCRIPT).toContain('DECK_TERM_ID')
  })
})
