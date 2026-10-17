'use client'

import { Compass } from 'lucide-react'
import type { TourId } from '@/tours/registry'
import { useTours } from './TourProvider'

interface Props {
  /** Which tour to replay. Default: the first tour this page offers. */
  id?: TourId
  className?: string
}

/**
 * "Show me around": replays the page's tour on demand. Renders nothing when
 * the page offers no tour that applies to this viewer, so it can sit in a
 * header permanently.
 */
export default function TourButton({ id, className = '' }: Props): React.ReactElement | null {
  const { pageTours, start } = useTours()
  const target = id && pageTours.includes(id) ? id : id ? undefined : pageTours[0]
  if (!target) return null

  return (
    <button
      type="button"
      onClick={() => { void start(target) }}
      className={`type-control inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-0 text-foreground-secondary transition-colors hover:text-gold ${className}`}
      data-testid="tour-replay"
    >
      <Compass className="h-4 w-4" aria-hidden="true" />
      Show me around
    </button>
  )
}
