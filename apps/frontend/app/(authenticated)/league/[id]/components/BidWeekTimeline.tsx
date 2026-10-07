'use client'

import { useEffect, useState } from 'react'
import { Gavel, Swords } from 'lucide-react'
import { getBidPhase, formatDeadlineShort } from './utils'
import { TimeRemaining } from './BidAmountAndDeadline'

interface BidWeekTimelineProps {
  /** From get_new_bid_cutoff(); null when the league has the cutoff disabled. */
  cutoffAt: string | null
  /** This cycle's weekly processing deadline. */
  processingDeadline: string | null
}

/**
 * The bidding week as a single bar, notched where new bids stop.
 *
 * The feature this represents is a week cut in two, so the bar shows the cut
 * rather than describing it: a filled track for time elapsed, a notch at the
 * cutoff, and a label under each half. Which half you are standing in is the
 * one thing a manager needs to know before opening the bid modal, and it reads
 * here without parsing a sentence.
 *
 * Renders nothing when the league has no cutoff configured -- there is no split
 * to draw, and an always-full bar would just be furniture.
 *
 * Everything it draws depends on the clock, and two of those dependencies break
 * server rendering: the fill width is a continuous function of "now", and the
 * labels format in the viewer's timezone, which on Vercel is UTC on the server
 * and something else in the browser. Both hydrate-mismatch -- the timezone one
 * on every request from outside UTC. So the clock is read once after mount and
 * the first paint is a placeholder holding the same height, which keeps the
 * header card from reflowing when the real bar replaces it.
 *
 * `isCounterBidPhase` is left to render normally elsewhere: it compares two
 * absolute timestamps, so server and client agree except in the sub-second
 * window where the cutoff passes between them.
 *
 * After mount the clock ticks once a minute, so a page left open moves the
 * fill, the countdown and the phase with it. The labels are plain text, not a
 * live region: BiddingShell announces the phase change once, and a countdown
 * that spoke every minute would drown everything else out.
 * @design-system League
 */
export default function BidWeekTimeline({
  cutoffAt,
  processingDeadline,
}: BidWeekTimelineProps): React.ReactElement | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  if (!cutoffAt || !processingDeadline) return null

  // Same height as the resolved bar, so the header card doesn't reflow.
  if (!now) {
    return (
      <div className="mt-4 pt-4 border-t border-border" data-testid="bid-week-timeline">
        <div className="h-4 mb-2.5" />
        <div className="h-1.5 rounded-full bg-elevated" />
        <div className="h-4 mt-2" />
      </div>
    )
  }

  const { isCounterBidPhase, cutoffFraction, elapsedFraction } = getBidPhase(
    cutoffAt,
    processingDeadline,
    now,
  )
  const cutoffPct = `${cutoffFraction * 100}%`
  const elapsedPct = `${elapsedFraction * 100}%`

  return (
    <div className="mt-4 pt-4 border-t border-border" data-testid="bid-week-timeline">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <p className="type-meta text-foreground-secondary">Bidding week</p>
        <p
          className={`type-meta ${isCounterBidPhase ? 'text-gold' : 'text-foreground-secondary'}`}
          data-testid="bid-phase-label"
        >
          {isCounterBidPhase
            ? 'Counter bids only'
            : <>New bids close in <TimeRemaining deadline={cutoffAt} /></>}
        </p>
      </div>

      {/* The bar is decorative -- the labels around it carry the same
          information for anyone not reading it visually. */}
      <div
        className="relative h-1.5 rounded-full bg-elevated overflow-hidden"
        aria-hidden="true"
      >
        {/* The counter-bid stretch, tinted so the two regimes are distinct even
            before the fill reaches the notch. */}
        <div
          className="absolute inset-y-0 right-0 bg-gold/10"
          style={{ left: cutoffPct }}
        />
        {/* Time elapsed this week. */}
        <div
          className="absolute inset-y-0 left-0 bg-gold transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: elapsedPct }}
        />
        {/* The cut itself: a gap punched through the bar at the cutoff. */}
        <div
          className="absolute inset-y-0 w-0.5 -ml-px bg-background"
          style={{ left: cutoffPct }}
        />
      </div>

      <div className="flex items-start justify-between gap-4 mt-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Gavel
            className={`w-3.5 h-3.5 flex-shrink-0 ${isCounterBidPhase ? 'text-foreground-muted' : 'text-gold'}`}
            aria-hidden="true"
          />
          <p
            className="type-meta text-foreground-secondary"
          >
            Open bidding{' '}
            <span className="text-foreground-secondary">
              {isCounterBidPhase ? 'closed' : 'to'} {formatDeadlineShort(cutoffAt)}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 min-w-0 text-right">
          <Swords
            className={`w-3.5 h-3.5 flex-shrink-0 ${isCounterBidPhase ? 'text-gold' : 'text-foreground-muted'}`}
            aria-hidden="true"
          />
          <p
            className="type-meta text-foreground-secondary"
          >
            Counter bids{' '}
            <span className="text-foreground-secondary">
              to {formatDeadlineShort(processingDeadline)}
            </span>
          </p>
        </div>
      </div>

      {isCounterBidPhase && (
        <p className="type-meta mt-2.5 text-foreground-secondary animate-fade-in">
          Raise or counter bids on movies already in play. Movies nobody has bid on reopen after
          this week&apos;s bids are processed, and bids placed now can&apos;t be withdrawn.
        </p>
      )}
    </div>
  )
}
