import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { countLeaves, findLeaf, MAX_PANES, type Dir, type PathStep } from '../../shared/layout'
import type { DropZone } from '../../shared/ipc'
import { ccVisualOf, titleOf, type Layout, type Settings, type Terminal } from '../../shared/state'
import TerminalPane from './TerminalPane'
import { splitWouldBeTooSmall } from './paneSize'

interface Props {
  tabId: string
  layout: Layout
  settings: Settings
  terminals: Record<string, Terminal>
  focusedTerminalId: string | null
  /** Focused pane temporarily maximized to fill the tab; view-only, not persisted. */
  zoomedId: string | null
  onUnzoom(): void
  keyFilter(e: KeyboardEvent): boolean
  onFocusPane(id: string): void
  /** Briefly shown near the cursor when a split/move is refused (past MAX_PANES, or the result would be too small); a custom message overrides the default "Max 9 panes per tab". */
  onCapHit(message?: string): void
}

/**
 * True for the whole lifetime of any tab-chip / sidebar-row drag (deck/terminal), regardless
 * of where over the window the pointer currently is. Lets every pane show a faint "you can
 * drop here" outline immediately on drag start, before the pointer settles over a specific
 * zone — the precise per-zone ghost preview (see Pane below) takes over from there.
 */
function useTerminalDragActive(): string | null {
  // The dragged terminal's id while a pane/tab/row drag is live ('' if unreadable), else null.
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const onDragStart = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('deck/terminal')) setActive(e.dataTransfer.getData('deck/terminal'))
    }
    const onDragEnd = (): void => setActive(null)
    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDragEnd)
    return () => {
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDragEnd)
    }
  }, [])
  return active
}

export default function SplitView(props: Props): JSX.Element {
  const canSplit = countLeaves(props.layout) < MAX_PANES
  const paneCount = countLeaves(props.layout)
  const dragActive = useTerminalDragActive()
  if (props.zoomedId && findLeaf(props.layout, props.zoomedId)) {
    return <Pane {...props} terminalId={props.zoomedId} canSplit={canSplit} paneCount={paneCount} dragActive={dragActive} zoomed />
  }
  return <Node {...props} node={props.layout} path={[]} canSplit={canSplit} paneCount={paneCount} dragActive={dragActive} />
}

interface NodeProps extends Props {
  node: Layout
  path: PathStep[]
  canSplit: boolean
  paneCount: number
  dragActive: string | null
}

function Node({ node, path, canSplit, paneCount, ...rest }: NodeProps): JSX.Element {
  if (node.type === 'leaf') {
    return <Pane {...rest} terminalId={node.terminalId} canSplit={canSplit} paneCount={paneCount} />
  }
  return <Split {...rest} node={node} path={path} canSplit={canSplit} paneCount={paneCount} />
}

function Split({ node, path, canSplit, ...rest }: NodeProps & { node: Extract<Layout, { type: 'split' }> }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startPos: number; startRatio: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  // Local, synchronous copy of the ratio for the live readout while dragging — node.ratio only
  // updates once the reducer round-trips over IPC, which is a beat too laggy for this.
  const [liveRatio, setLiveRatio] = useState(node.ratio)
  useEffect(() => { if (!dragging) setLiveRatio(node.ratio) }, [node.ratio, dragging])

  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      dragState.current = { startPos: node.dir === 'h' ? e.clientX : e.clientY, startRatio: node.ratio }
      const size = node.dir === 'h' ? rect.width : rect.height
      const minRatio = node.dir === 'h' ? 200 / size : 120 / size
      setDragging(true)

      const onMove = (ev: MouseEvent): void => {
        if (!dragState.current) return
        const pos = node.dir === 'h' ? ev.clientX : ev.clientY
        const delta = (pos - dragState.current.startPos) / size
        const ratio = Math.min(1 - minRatio, Math.max(minRatio, dragState.current.startRatio + delta))
        setLiveRatio(ratio)
        window.deck.setRatio(rest.tabId, path, ratio)
      }
      const onUp = (): void => {
        dragState.current = null
        setDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [node.dir, node.ratio, path, rest.tabId]
  )

  const grip = node.dir === 'h' ? '⋮' : '⋯'
  const readout = `${Math.round(liveRatio * 100)}% / ${Math.round((1 - liveRatio) * 100)}%`

  return (
    <div ref={containerRef} className={'split split--' + node.dir}>
      <div className="split__pane" style={{ flex: `${node.ratio} ${node.ratio} 0%` }}>
        <Node {...rest} node={node.a} path={[...path, 'a']} canSplit={canSplit} />
      </div>
      <div
        className={'divider divider--' + node.dir + (dragging ? ' divider--dragging' : '')}
        onMouseDown={onDividerDown}
        onDoubleClick={() => window.deck.setRatio(rest.tabId, path, 0.5)}
        title="Drag to resize · double-click to reset 50/50"
      >
        <span className="divider__grip">{dragging ? readout : grip}</span>
      </div>
      <div className="split__pane" style={{ flex: `${1 - node.ratio} ${1 - node.ratio} 0%` }}>
        <Node {...rest} node={node.b} path={[...path, 'b']} canSplit={canSplit} />
      </div>
    </div>
  )
}

function zoneAt(rect: DOMRect, x: number, y: number): DropZone {
  const rx = (x - rect.left) / rect.width
  const ry = (y - rect.top) / rect.height
  const EDGE = 0.25
  if (rx < EDGE && rx < ry && rx < 1 - ry) return 'left'
  if (rx > 1 - EDGE && 1 - rx < ry && 1 - rx < 1 - ry) return 'right'
  if (ry < EDGE) return 'top'
  if (ry > 1 - EDGE) return 'bottom'
  return 'center'
}

/**
 * Where the ghost preview sits for each zone — the pane's actual resulting geometry (half the
 * pane for a split, the whole pane for a swap), not the smaller edge band used to detect
 * the zone. This is what makes the preview read as "here's what you'll get".
 */
function ghostRect(zone: DropZone): { left: string; top: string; width: string; height: string } {
  switch (zone) {
    case 'left': return { left: '0%', top: '0%', width: '50%', height: '100%' }
    case 'right': return { left: '50%', top: '0%', width: '50%', height: '100%' }
    case 'top': return { left: '0%', top: '0%', width: '100%', height: '50%' }
    case 'bottom': return { left: '0%', top: '50%', width: '100%', height: '50%' }
    case 'center': return { left: '0%', top: '0%', width: '100%', height: '100%' }
  }
}

function Pane({
  terminalId,
  tabId,
  layout,
  settings,
  terminals,
  focusedTerminalId,
  keyFilter,
  onFocusPane,
  canSplit,
  dragActive,
  onCapHit,
  paneCount,
  zoomed,
  onUnzoom
}: Props & { terminalId: string; canSplit: boolean; paneCount: number; dragActive: string | null; zoomed?: boolean }): JSX.Element {
  const [zone, setZone] = useState<DropZone | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  // Belt-and-suspenders: a drag that ends outside this pane (released over the tab bar, the
  // sidebar, or even outside the window) never fires this pane's own dragleave/drop, which
  // would otherwise leave its ghost preview stuck lit indefinitely.
  useEffect(() => {
    const clear = (): void => setZone(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  const onDragOver = (e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes('deck/terminal')) return
    e.preventDefault()
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    const z = zoneAt(rect, e.clientX, e.clientY)
    if (z !== 'center' && !canSplit) { setZone(null); return } // cap hit: only the swap zone stays live
    if (z !== 'center' && splitWouldBeTooSmall(layout, terminalId, z === 'left' || z === 'right' ? 'h' : 'v')) { setZone(null); return }
    e.dataTransfer.dropEffect = 'move'
    setZone(z)
  }
  const onDragLeave = (e: React.DragEvent): void => {
    if (!hostRef.current?.contains(e.relatedTarget as Node | null)) setZone(null)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('deck/terminal')
    // Decide from the drop point itself, not the `zone` state: that state is whatever the last
    // *rendered* dragover saw (often the edge the pointer entered through), so reading it here
    // turned center "swap" drops into edge splits.
    const rect = hostRef.current?.getBoundingClientRect()
    const z = rect ? zoneAt(rect, e.clientX, e.clientY) : null
    setZone(null)
    if (!draggedId || !z) return
    if (z !== 'center' && !canSplit) { onCapHit(); return }
    if (z !== 'center') {
      const dir: Dir = z === 'left' || z === 'right' ? 'h' : 'v'
      if (splitWouldBeTooSmall(layout, terminalId, dir)) { onCapHit('Pane too small to split'); return }
    }
    void window.deck.movePane(draggedId, tabId, terminalId, z)
  }

  const terminal = terminals[terminalId]
  const cc = terminal ? ccVisualOf(terminal) : null
  const unseen = !!terminal?.cc?.unseen
  // The pane-level "you can spot it in a 9-grid" treatment only earns its keep once there's
  // actually more than one pane to scan — a single-pane tab already has the tab chip + sidebar
  // row for that.
  const showChrome = paneCount > 1
  const attnClass = showChrome && unseen && (cc === 'done' || cc === 'input') ? ' pane-slot--cc-' + cc : ''
  const glyph = cc === 'done' ? '✓' : cc === 'input' ? '?' : ''

  return (
    <div
      ref={hostRef}
      className={
        'pane-slot' +
        (terminalId === focusedTerminalId ? ' pane-slot--focused' : '') +
        attnClass +
        (dragActive !== null ? ' pane-slot--drop-target' : '') +
        // Cover every pane except the one being dragged: covering the drag source's own header
        // makes Chromium cancel the drag on the first mouse move.
        (dragActive !== null && dragActive !== terminalId ? ' pane-slot--drop-cover' : '') +
        (zone ? ' pane-slot--drag-over' : '')
      }
      data-terminal-id={terminalId}
      onMouseDown={() => onFocusPane(terminalId)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {showChrome && terminal && (
        <div
          className="pane-header"
          draggable
          title="Drag onto another pane: edge to split, center to swap"
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('deck/terminal', terminalId) }}
        >
          <span className="pane-header__grip" aria-hidden="true">⠿</span>
          {cc && <span className={'pane-header__dot pane-header__dot--cc-' + cc}>{glyph}</span>}
          <span className="pane-header__title">{titleOf(terminal)}</span>
          {zoomed && (
            <button
              className="pane-header__unzoom"
              title="Exit zoom (⌘⇧Enter)"
              onClick={(e) => { e.stopPropagation(); onUnzoom() }}
            >
              ⤢
            </button>
          )}
        </div>
      )}
      <TerminalPane terminalId={terminalId} settings={settings} keyFilter={keyFilter} />
      {zone && (
        <div
          className={'drop-ghost' + (zone === 'center' ? ' drop-ghost--swap' : ' drop-ghost--split')}
          style={ghostRect(zone)}
        >
          <span className="drop-ghost__label">{zone === 'center' ? 'Swap' : 'Split'}</span>
        </div>
      )}
    </div>
  )
}
