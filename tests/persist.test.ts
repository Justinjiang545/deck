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

  it('prunes tabs, folder refs and derives layout from activeTabId', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, JSON.stringify({
      terminals: { a: { id: 'a', createdAt: 1, cwd: '/', fgCommand: 'zsh', lastActivity: 1, cc: null, folderId: 'gone' } },
      folders: {}, openTabs: ['a', 'zombie'], activeTabId: 'zombie', selectedFolderId: 'gone',
      layout: { type: 'leaf', terminalId: 'zombie' }, focusedTerminalId: 'zombie', sidebarOpen: true, settings: {}
    }))
    const s = loadState(file, initialState(HOME))
    expect(s.openTabs).toEqual(['a'])
    expect(s.activeTabId).toBeNull()
    expect(s.layout).toBeNull()
    expect(s.focusedTerminalId).toBeNull()
    expect(s.terminals['a']?.folderId).toBeUndefined()
    expect(s.selectedFolderId).toBeNull()
  })

  it('round-trips a multi-pane layout, including tabFocus', () => {
    const file = join(dir, 'state.json')
    const splitLayout = {
      type: 'split' as const,
      dir: 'h' as const,
      ratio: 0.5,
      a: { type: 'leaf' as const, terminalId: 'a' },
      b: { type: 'leaf' as const, terminalId: 'b' }
    }
    const s = {
      ...initialState(HOME),
      terminals: {
        a: { id: 'a', createdAt: 1, cwd: '/', fgCommand: 'zsh', lastActivity: 1, cc: null },
        b: { id: 'b', createdAt: 2, cwd: '/', fgCommand: 'zsh', lastActivity: 2, cc: null }
      },
      openTabs: ['a'],
      activeTabId: 'a',
      layouts: { a: splitLayout },
      tabFocus: { a: 'b' },
      layout: splitLayout,
      focusedTerminalId: 'b'
    }
    saveStateNow(file, s)
    const loaded = loadState(file, initialState(HOME))
    expect(loaded.layouts).toEqual(s.layouts)
    expect(loaded.layout).toEqual(s.layouts['a'])
    expect(loaded.tabFocus).toEqual({ a: 'b' })
    expect(loaded.focusedTerminalId).toBe('b')
  })

  it('collapses a split leaf whose terminal no longer exists, on load', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, JSON.stringify({
      terminals: { a: { id: 'a', createdAt: 1, cwd: '/', fgCommand: 'zsh', lastActivity: 1, cc: null } },
      folders: {},
      openTabs: ['a'],
      activeTabId: 'a',
      layouts: { a: { type: 'split', dir: 'h', ratio: 0.5, a: { type: 'leaf', terminalId: 'a' }, b: { type: 'leaf', terminalId: 'gone' } } },
      tabFocus: { a: 'gone' },
      layout: null,
      focusedTerminalId: null,
      sidebarOpen: true,
      settings: {}
    }))
    const s = loadState(file, initialState(HOME))
    expect(s.layouts['a']).toEqual({ type: 'leaf', terminalId: 'a' })
    expect(s.layout).toEqual({ type: 'leaf', terminalId: 'a' })
    expect(s.tabFocus['a']).toBeUndefined()
    expect(s.focusedTerminalId).toBe('a')
  })

  it('old single-pane state.json (no layouts field) still loads as a leaf per open tab', () => {
    const file = join(dir, 'state.json')
    writeFileSync(file, JSON.stringify({
      terminals: { a: { id: 'a', createdAt: 1, cwd: '/', fgCommand: 'zsh', lastActivity: 1, cc: null } },
      folders: {},
      openTabs: ['a'],
      activeTabId: 'a',
      layout: { type: 'leaf', terminalId: 'a' },
      focusedTerminalId: 'a',
      sidebarOpen: true,
      settings: {}
    }))
    const s = loadState(file, initialState(HOME))
    expect(s.layouts['a']).toEqual({ type: 'leaf', terminalId: 'a' })
    expect(s.openTabs).toEqual(['a'])
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
