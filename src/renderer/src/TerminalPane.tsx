import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { Settings, ThemeName } from '../../shared/state'
import { quotePaths } from '../../shared/shellquote'

interface Props {
  terminalId: string
  settings: Settings
  /** Return true from the handler to let xterm process the key; false to let the app handle it. */
  keyFilter(e: KeyboardEvent): boolean
}

// One xterm palette per bundled theme (see :root[data-theme] in styles.css) so the terminal
// canvas matches the surrounding chrome instead of always rendering the same dark palette.
const XTERM_THEMES: Record<ThemeName, ITheme> = {
  graphite: {
    background: '#0e0f11', foreground: '#d6d8dc', cursor: '#d6d8dc', cursorAccent: '#0e0f11',
    selectionBackground: 'rgba(122,162,247,0.28)',
    black: '#1a1c20', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
    brightBlack: '#565f89', brightRed: '#ff7a93', brightGreen: '#b9f27c', brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#c4a5ff', brightCyan: '#8de0ff', brightWhite: '#e6e6e6'
  },
  ember: {
    background: '#151110', foreground: '#e8ddd6', cursor: '#e8ddd6', cursorAccent: '#151110',
    selectionBackground: 'rgba(232,138,90,0.28)',
    black: '#241c19', red: '#e8685a', green: '#b8a96a', yellow: '#e8a23a', blue: '#d98f5f', magenta: '#c77b5f', cyan: '#c99a6a', white: '#e0d3c8',
    brightBlack: '#6b564c', brightRed: '#ff8674', brightGreen: '#d4c27e', brightYellow: '#ffb85a', brightBlue: '#f2ab7c', brightMagenta: '#e0977c', brightCyan: '#e3b686', brightWhite: '#f5ece3'
  },
  tide: {
    background: '#0a1416', foreground: '#cfe3e3', cursor: '#cfe3e3', cursorAccent: '#0a1416',
    selectionBackground: 'rgba(90,190,200,0.28)',
    black: '#132327', red: '#e87a8f', green: '#6fc9a8', yellow: '#d8c06a', blue: '#5aa9d6', magenta: '#8fa6d6', cyan: '#5ec4c9', white: '#c3d9d9',
    brightBlack: '#4d6a6e', brightRed: '#ff96a8', brightGreen: '#8ee3c1', brightYellow: '#f0d788', brightBlue: '#7cc2ee', brightMagenta: '#aabdf0', brightCyan: '#7fe0e5', brightWhite: '#e6f4f4'
  },
  paper: {
    background: '#f4efe6', foreground: '#2b2620', cursor: '#2b2620', cursorAccent: '#f4efe6',
    selectionBackground: 'rgba(178,124,58,0.22)',
    black: '#33302a', red: '#b64a3d', green: '#5c7a3a', yellow: '#a5791f', blue: '#3f6ea3', magenta: '#8a5a99', cyan: '#3c7d80', white: '#5a544a',
    brightBlack: '#7a7365', brightRed: '#c85f4f', brightGreen: '#6d8f47', brightYellow: '#bd8b2a', brightBlue: '#4f81b8', brightMagenta: '#9d6bac', brightCyan: '#4c9396', brightWhite: '#2b2620'
  }
}

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tiff' }

/** Resolve dropped/pasted Files to shell paths: real files by path, path-less images saved to the pastes dir. */
async function pathsFor(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    const p = window.deck.pathForFile(f)
    if (p) { out.push(p); continue }
    const ext = IMAGE_EXT[f.type]
    if (!ext) continue
    out.push(await window.deck.savePaste(new Uint8Array(await f.arrayBuffer()), ext))
  }
  return out
}

export default function TerminalPane({ terminalId, settings, keyFilter }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const termRef = useRef<XTerm | null>(null)
  // The WebGL addon precomputes a glyph/color texture atlas for performance, so just setting
  // `options.theme` repaints the DOM chrome but leaves already-cached glyphs on their old
  // colors — clearTextureAtlas() forces it to rebuild from the new theme.
  const webglRef = useRef<WebglAddon | null>(null)

  // Applied live (no re-init, no scrollback loss) whenever the bundled theme changes.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = XTERM_THEMES[settings.theme]
    webglRef.current?.clearTextureAtlas()
    term.refresh(0, term.rows - 1)
  }, [settings.theme])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new XTerm({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      scrollback: 50000,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollOnEraseInDisplay: true,
      theme: XTERM_THEMES[settings.theme]
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    try {
      const webgl = new WebglAddon()
      term.loadAddon(webgl)
      webglRef.current = webgl
    } catch {
      console.warn('WebGL addon failed to load; falling back to canvas renderer')
    }
    term.attachCustomKeyEventHandler((e) => keyFilter(e))
    fit.fit()

    let attached = false
    const offData = window.deck.onPtyData((id, data) => { if (id === terminalId) term.write(data) })
    const offExit = window.deck.onPtyExit((id) => { if (id === terminalId) term.write('\r\n\x1b[2m[detached]\x1b[0m\r\n') })
    const onInput = term.onData((d) => { if (attached) window.deck.ptyWrite(terminalId, d) })

    void window.deck.ptyAttach(terminalId, term.cols, term.rows).then(() => {
      attached = true
      term.focus()
      window.deck.ptyResize(terminalId, term.cols, term.rows)
    })

    // Typing paths for dropped files / pasted screenshots. Insert at the cursor, no Enter.
    const typePaths = (files: File[]): void => {
      if (!files.length) return
      void pathsFor(files).then((paths) => {
        if (paths.length && attached) { window.deck.ptyWrite(terminalId, quotePaths(paths)); term.focus() }
      })
    }
    const onDrop = (e: DragEvent): void => {
      // Only Finder file drops are ours; pane-arranging drags ('deck/terminal') must bubble up
      // to SplitView's pane-slot drop handler.
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault(); e.stopPropagation(); setOver(false)
      typePaths(Array.from(e.dataTransfer?.files ?? []))
    }
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true)
    }
    const onDragLeave = (e: DragEvent): void => { if (!host.contains(e.relatedTarget as Node | null)) setOver(false) }
    // An image-only clipboard (fresh screenshot) has no text for xterm to paste; save it and type its path instead.
    const onPaste = (e: ClipboardEvent): void => {
      const dt = e.clipboardData
      if (!dt || dt.getData('text/plain')) return
      const files = Array.from(dt.files).filter((f) => IMAGE_EXT[f.type])
      if (!files.length) return
      e.preventDefault(); e.stopPropagation()
      typePaths(files)
    }
    host.addEventListener('drop', onDrop)
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('dragleave', onDragLeave)
    host.addEventListener('paste', onPaste, true)

    const ro = new ResizeObserver(() => {
      fit.fit()
      if (attached) window.deck.ptyResize(terminalId, term.cols, term.rows)
    })
    ro.observe(host)

    return () => {
      host.removeEventListener('drop', onDrop)
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('dragleave', onDragLeave)
      host.removeEventListener('paste', onPaste, true)
      ro.disconnect()
      offData(); offExit(); onInput.dispose()
      void window.deck.ptyDetach(terminalId)
      term.dispose()
      if (termRef.current === term) termRef.current = null
      webglRef.current = null
    }
  }, [terminalId, settings.fontFamily, settings.fontSize])

  return <div className={'pane' + (over ? ' pane--over' : '')} ref={hostRef} />
}
