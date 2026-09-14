import { reduce, Store } from '../src/main/store'
import {
  initialState,
  titleOf,
  sortedTerminals,
  sortedFolders,
  terminalsInFolder,
  placementFolder,
  type Terminal
} from '../src/shared/state'

const HOME = '/Users/test'
function term(id: string, extra: Partial<Terminal> = {}): Terminal {
  return { id, createdAt: 1000, cwd: HOME, fgCommand: 'zsh', lastActivity: 1000, cc: null, ...extra }
}

describe('reduce', () => {
  it('ADD_TERMINAL adds and does not change layout', () => {
    const s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    expect(s.terminals['a']?.id).toBe('a')
    expect(s.layout).toBeNull()
  })

  it('SHOW_TERMINAL sets a leaf layout and focus', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'a' })
    expect(s.layout).toEqual({ type: 'leaf', terminalId: 'a' })
    expect(s.focusedTerminalId).toBe('a')
  })

  it('SHOW_TERMINAL ignores unknown ids', () => {
    const s0 = initialState(HOME)
    expect(reduce(s0, { type: 'SHOW_TERMINAL', id: 'nope' })).toBe(s0)
  })

  it('REMOVE_TERMINAL clears layout/focus if it was shown', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'a' })
    s = reduce(s, { type: 'REMOVE_TERMINAL', id: 'a' })
    expect(s.terminals['a']).toBeUndefined()
    expect(s.layout).toBeNull()
    expect(s.focusedTerminalId).toBeNull()
  })

  it('REMOVE_TERMINAL leaves layout alone if another terminal is shown', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('b') })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'b' })
    s = reduce(s, { type: 'REMOVE_TERMINAL', id: 'a' })
    expect(s.layout).toEqual({ type: 'leaf', terminalId: 'b' })
    expect(s.focusedTerminalId).toBe('b')
  })

  it('UPDATE_TERMINAL patches cwd/fgCommand and returns same object when nothing changes', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    const s2 = reduce(s, { type: 'UPDATE_TERMINAL', id: 'a', patch: { cwd: '/tmp', fgCommand: 'vim' } })
    expect(s2.terminals['a']).toMatchObject({ cwd: '/tmp', fgCommand: 'vim' })
    const s3 = reduce(s2, { type: 'UPDATE_TERMINAL', id: 'a', patch: { cwd: '/tmp', fgCommand: 'vim' } })
    expect(s3).toBe(s2)
  })

  it('RENAME_TERMINAL sets and clears customTitle', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'RENAME_TERMINAL', id: 'a', title: 'api' })
    expect(s.terminals['a']?.customTitle).toBe('api')
    s = reduce(s, { type: 'RENAME_TERMINAL', id: 'a', title: null })
    expect(s.terminals['a']?.customTitle).toBeUndefined()
  })

  it('CLOSE_PANE nulls layout only if that terminal is shown', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'a' })
    const same = reduce(s, { type: 'CLOSE_PANE', id: 'other' })
    expect(same).toBe(s)
    s = reduce(s, { type: 'CLOSE_PANE', id: 'a' })
    expect(s.layout).toBeNull()
    expect(s.focusedTerminalId).toBeNull()
    expect(s.terminals['a']).toBeDefined()
  })

  it('SET_SIDEBAR toggles', () => {
    const s = reduce(initialState(HOME), { type: 'SET_SIDEBAR', open: false })
    expect(s.sidebarOpen).toBe(false)
  })

  it('TOUCH_PROJECT moves path to front, dedupes, caps at 20', () => {
    let s = initialState(HOME)
    for (let i = 0; i < 25; i++) s = reduce(s, { type: 'TOUCH_PROJECT', path: `/p/${i}` })
    s = reduce(s, { type: 'TOUCH_PROJECT', path: '/p/5' })
    expect(s.settings.recentProjects[0]).toBe('/p/5')
    expect(s.settings.recentProjects.length).toBe(20)
    expect(new Set(s.settings.recentProjects).size).toBe(20)
  })

  it('HYDRATE replaces state', () => {
    const other = { ...initialState(HOME), sidebarOpen: false }
    expect(reduce(initialState(HOME), { type: 'HYDRATE', state: other })).toBe(other)
  })
})

describe('titleOf / sortedTerminals', () => {
  it('prefers customTitle, then non-shell command, then cwd basename', () => {
    expect(titleOf(term('a', { customTitle: 'x' }))).toBe('x')
    expect(titleOf(term('a', { fgCommand: 'claude' }))).toBe('claude')
    expect(titleOf(term('a', { cwd: '/Users/test/Documents/GitHub/Roll' }))).toBe('Roll')
    expect(titleOf(term('a', { cwd: '/' }))).toBe('/')
  })
  it('sorts by createdAt', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('b', { createdAt: 2 }) })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('a', { createdAt: 1 }) })
    expect(sortedTerminals(s).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('folders', () => {
  const folder = (id: string, order = 0) => ({ id, name: id, order, collapsed: false })

  it('ADD_FOLDER / RENAME_FOLDER / SET_FOLDER_COLLAPSED', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('f1') })
    s = reduce(s, { type: 'RENAME_FOLDER', id: 'f1', name: '  Roll ' })
    s = reduce(s, { type: 'SET_FOLDER_COLLAPSED', id: 'f1', collapsed: true })
    expect(s.folders['f1']).toEqual({ id: 'f1', name: 'Roll', order: 0, collapsed: true })
    expect(reduce(s, { type: 'RENAME_FOLDER', id: 'f1', name: '   ' })).toBe(s)
  })

  it('MOVE_TERMINAL sets/clears folderId and ignores unknown folders', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('f1') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'MOVE_TERMINAL', id: 'a', folderId: 'f1' })
    expect(s.terminals['a']?.folderId).toBe('f1')
    expect(reduce(s, { type: 'MOVE_TERMINAL', id: 'a', folderId: 'nope' })).toBe(s)
    s = reduce(s, { type: 'MOVE_TERMINAL', id: 'a', folderId: null })
    expect(s.terminals['a']?.folderId).toBeUndefined()
  })

  it('DELETE_FOLDER re-files its terminals to Unfiled and clears selection', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('f1') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('a', { folderId: 'f1' }) })
    s = reduce(s, { type: 'SELECT_FOLDER', id: 'f1' })
    s = reduce(s, { type: 'DELETE_FOLDER', id: 'f1' })
    expect(s.folders['f1']).toBeUndefined()
    expect(s.terminals['a']?.folderId).toBeUndefined()
    expect(s.selectedFolderId).toBeNull()
  })

  it('REORDER_FOLDERS assigns order by index; sortedFolders follows it', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('a', 0) })
    s = reduce(s, { type: 'ADD_FOLDER', folder: folder('b', 1) })
    s = reduce(s, { type: 'REORDER_FOLDERS', ids: ['b', 'a'] })
    expect(sortedFolders(s).map((f) => f.id)).toEqual(['b', 'a'])
  })

  it('REORDER_FOLDERS is a no-op (identity) when order is unchanged or ids are unknown', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('a', 0) })
    s = reduce(s, { type: 'ADD_FOLDER', folder: folder('b', 1) })
    expect(reduce(s, { type: 'REORDER_FOLDERS', ids: ['a', 'b'] })).toBe(s)
    expect(reduce(s, { type: 'REORDER_FOLDERS', ids: ['nope'] })).toBe(s)
  })

  it('DELETE_FOLDER keeps terminals identity when the folder has no terminals', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('f1') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('a') })
    const before = s.terminals
    s = reduce(s, { type: 'DELETE_FOLDER', id: 'f1' })
    expect(s.terminals).toBe(before)
  })

  it('terminalsInFolder and placementFolder', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_FOLDER', folder: folder('f1') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('a', { folderId: 'f1', createdAt: 2 }) })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('b', { createdAt: 1 }) })
    expect(terminalsInFolder(s, 'f1').map((t) => t.id)).toEqual(['a'])
    expect(terminalsInFolder(s, null).map((t) => t.id)).toEqual(['b'])
    expect(placementFolder(s)).toBeNull()
    s = reduce(s, { type: 'SELECT_FOLDER', id: 'f1' })
    expect(placementFolder(s)).toBe('f1')
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'b' })   // focused terminal b is Unfiled → wins over selection
    expect(placementFolder(s)).toBeNull()
  })
})

describe('tabs', () => {
  it('SHOW_TERMINAL opens a tab once and activates it', () => {
    let s = reduce(initialState(HOME), { type: 'ADD_TERMINAL', terminal: term('a') })
    s = reduce(s, { type: 'ADD_TERMINAL', terminal: term('b') })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'a' })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'b' })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'a' })
    expect(s.openTabs).toEqual(['a', 'b'])
    expect(s.activeTabId).toBe('a')
    expect(s.layout).toEqual({ type: 'leaf', terminalId: 'a' })
    expect(s.focusedTerminalId).toBe('a')
  })

  it('CLOSE_PANE removes the tab and activates the right neighbour, else left', () => {
    let s = initialState(HOME)
    for (const id of ['a', 'b', 'c']) s = reduce(s, { type: 'ADD_TERMINAL', terminal: term(id) })
    for (const id of ['a', 'b', 'c']) s = reduce(s, { type: 'SHOW_TERMINAL', id })
    s = reduce(s, { type: 'SHOW_TERMINAL', id: 'b' })
    s = reduce(s, { type: 'CLOSE_PANE', id: 'b' })
    expect(s.openTabs).toEqual(['a', 'c'])
    expect(s.activeTabId).toBe('c')
    s = reduce(s, { type: 'CLOSE_PANE', id: 'c' })
    expect(s.activeTabId).toBe('a')
    s = reduce(s, { type: 'CLOSE_PANE', id: 'a' })
    expect(s.activeTabId).toBeNull()
    expect(s.layout).toBeNull()
    expect(s.focusedTerminalId).toBeNull()
    expect(s.terminals['a']).toBeDefined()
  })

  it('closing an inactive tab keeps the active one', () => {
    let s = initialState(HOME)
    for (const id of ['a', 'b']) s = reduce(s, { type: 'ADD_TERMINAL', terminal: term(id) })
    for (const id of ['a', 'b']) s = reduce(s, { type: 'SHOW_TERMINAL', id })
    s = reduce(s, { type: 'CLOSE_PANE', id: 'a' })
    expect(s.openTabs).toEqual(['b'])
    expect(s.activeTabId).toBe('b')
  })

  it('REMOVE_TERMINAL also closes its tab', () => {
    let s = initialState(HOME)
    for (const id of ['a', 'b']) s = reduce(s, { type: 'ADD_TERMINAL', terminal: term(id) })
    for (const id of ['a', 'b']) s = reduce(s, { type: 'SHOW_TERMINAL', id })
    s = reduce(s, { type: 'REMOVE_TERMINAL', id: 'b' })
    expect(s.openTabs).toEqual(['a'])
    expect(s.activeTabId).toBe('a')
    expect(s.layout).toEqual({ type: 'leaf', terminalId: 'a' })
  })

  it('REORDER_TABS accepts only a permutation', () => {
    let s = initialState(HOME)
    for (const id of ['a', 'b']) s = reduce(s, { type: 'ADD_TERMINAL', terminal: term(id) })
    for (const id of ['a', 'b']) s = reduce(s, { type: 'SHOW_TERMINAL', id })
    expect(reduce(s, { type: 'REORDER_TABS', ids: ['b'] })).toBe(s)
    s = reduce(s, { type: 'REORDER_TABS', ids: ['b', 'a'] })
    expect(s.openTabs).toEqual(['b', 'a'])
  })
})

describe('Store', () => {
  it('notifies subscribers only when state changes', () => {
    const store = new Store(initialState(HOME))
    const seen: number[] = []
    const off = store.subscribe(() => seen.push(1))
    store.dispatch({ type: 'SHOW_TERMINAL', id: 'nope' }) // no-op
    store.dispatch({ type: 'ADD_TERMINAL', terminal: term('a') })
    off()
    store.dispatch({ type: 'ADD_TERMINAL', terminal: term('b') })
    expect(seen.length).toBe(1)
    expect(Object.keys(store.state.terminals)).toEqual(['a', 'b'])
  })
})
