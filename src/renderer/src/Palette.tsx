import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { fuzzyFilter } from './fuzzy'

export interface PaletteItem {
  id: string
  label: string
  detail?: string
}

interface Props {
  placeholder: string
  items: PaletteItem[]
  /** Called with the chosen item, or with a raw path if the query looks like one (starts with / or ~). */
  onPick(choice: { item: PaletteItem } | { raw: string }): void
  /** Escape, or Enter with no query: per spec "Escape/blank = $HOME" — creates a terminal at $HOME. */
  onClose(): void
  /** Click outside the palette (backdrop): just hides the palette, no terminal is created. */
  onDismiss(): void
}

export default function Palette({ placeholder, items, onPick, onClose, onDismiss }: Props): JSX.Element {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => fuzzyFilter(q, items, (i) => i.label + ' ' + (i.detail ?? '')), [q, items])
  const isPath = /^[~/]/.test(q)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setIdx(0) }, [q])

  const choose = (): void => {
    if (isPath) return onPick({ raw: q })
    const item = filtered[idx]
    if (item) onPick({ item })
  }

  return (
    <div className="palette__backdrop" onMouseDown={onDismiss}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') choose()
            else if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, filtered.length - 1))
            else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0))
            else return
            e.preventDefault()
          }}
        />
        <div className="palette__list">
          {isPath && <div className="palette__item palette__item--active">Open {q}</div>}
          {!isPath && filtered.slice(0, 50).map((it, i) => (
            <div
              key={it.id}
              className={'palette__item' + (i === idx ? ' palette__item--active' : '')}
              onMouseEnter={() => setIdx(i)}
              onClick={() => onPick({ item: it })}
            >
              <span className="palette__label">{it.label}</span>
              {it.detail && <span className="palette__detail">{it.detail}</span>}
            </div>
          ))}
          {!isPath && filtered.length === 0 && <div className="palette__empty">No matches — type a path starting with / or ~</div>}
        </div>
      </div>
    </div>
  )
}
