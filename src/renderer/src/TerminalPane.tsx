import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { Settings } from '../../shared/state'

interface Props {
  terminalId: string
  settings: Settings
  /** Return true from the handler to let xterm process the key; false to let the app handle it. */
  keyFilter(e: KeyboardEvent): boolean
}

const THEME = {
  background: '#0e0f11', foreground: '#d6d8dc', cursor: '#d6d8dc', cursorAccent: '#0e0f11',
  selectionBackground: 'rgba(122,162,247,0.28)',
  black: '#1a1c20', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
  brightBlack: '#565f89', brightRed: '#ff7a93', brightGreen: '#b9f27c', brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#c4a5ff', brightCyan: '#8de0ff', brightWhite: '#e6e6e6'
}

export default function TerminalPane({ terminalId, settings, keyFilter }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

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
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    try { term.loadAddon(new WebglAddon()) } catch { console.warn('WebGL addon failed to load; falling back to canvas renderer') }
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

    const ro = new ResizeObserver(() => {
      fit.fit()
      if (attached) window.deck.ptyResize(terminalId, term.cols, term.rows)
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      offData(); offExit(); onInput.dispose()
      void window.deck.ptyDetach(terminalId)
      term.dispose()
    }
  }, [terminalId, settings.fontFamily, settings.fontSize])

  return <div className="pane" ref={hostRef} />
}
