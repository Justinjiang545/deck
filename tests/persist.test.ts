import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadState, saveStateNow, createSaver } from '../src/main/persist'
import { initialState } from '../src/shared/state'

const HOME = '/Users/test'
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deck-persist-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('persist', () => {
  it('returns fallback when file is missing', () => {
    const fb = initialState(HOME)
    expect(loadState(join(dir, 'state.json'), fb)).toBe(fb)
  })

  it('round-trips state', () => {
    const file = join(dir, 'state.json')
    const s = { ...initialState(HOME), sidebarOpen: false }
    saveStateNow(file, s)
    expect(loadState(file, initialState(HOME))).toEqual(s)
    expect(existsSync(file + '.tmp')).toBe(false)
  })

  it('fills missing settings keys from fallback', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, JSON.stringify({ terminals: {}, layout: null, focusedTerminalId: null, sidebarOpen: true, settings: { theme: 'ember' } }))
    const s = loadState(file, initialState(HOME))
    expect(s.settings.theme).toBe('ember')
    expect(s.settings.fontSize).toBe(13)
  })

  it('backs up corrupt file and returns fallback', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, '{not json')
    const fb = initialState(HOME)
    expect(loadState(file, fb)).toBe(fb)
    expect(existsSync(file + '.bak')).toBe(true)
    expect(existsSync(file)).toBe(false)
  })

  it('saver debounces and flush writes immediately', async () => {
    const file = join(dir, 'state.json')
    const saver = createSaver(file, 50)
    saver.schedule({ ...initialState(HOME), sidebarOpen: false })
    saver.schedule({ ...initialState(HOME), sidebarOpen: true })
    expect(existsSync(file)).toBe(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(JSON.parse(readFileSync(file, 'utf8')).sidebarOpen).toBe(true)
    saver.schedule({ ...initialState(HOME), sidebarOpen: false })
    saver.flush()
    expect(JSON.parse(readFileSync(file, 'utf8')).sidebarOpen).toBe(false)
  })
})
