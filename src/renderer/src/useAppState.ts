import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/state'

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    let alive = true
    void window.deck.getState().then((s) => { if (alive) setState(s) })
    const off = window.deck.onState((s) => setState(s))
    return () => { alive = false; off() }
  }, [])
  return state
}
