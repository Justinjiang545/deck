import { useId } from 'react'
import type { JSX } from 'react'

/** The deck mark (resources/brand/deck-mark.svg): a stack of cards, the front one a prompt. Inherits currentColor. */
export default function Logo({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  const mask = useId()
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <mask id={mask}>
        <rect width="32" height="32" fill="#fff" />
        <path d="M8.5 16.5l4 3.5-4 3.5" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="15" y="22" width="7" height="2.2" rx="1.1" fill="#000" />
      </mask>
      <rect x="8" y="3" width="16" height="2.4" rx="1.2" />
      <rect x="5" y="6.8" width="22" height="2.4" rx="1.2" />
      <rect x="2" y="10.6" width="28" height="18.4" rx="4.5" mask={`url(#${mask})`} />
    </svg>
  )
}
