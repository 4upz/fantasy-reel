'use client'

import { useMemo } from 'react'
import { Gavel, Swords } from 'lucide-react'
import { getBidPhase, formatDeadlineShort, formatTimeRemaining } from './utils'

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
 */
export default function BidWeekTimeline({
  cutoffAt,
  processingDeadline,
}: BidWeekTimelineProps): React.ReactElement | null {
  const phase = useMemo(
    () => getBidPhase(cutoffAt, processingDeadline),
    [cutoffAt, processingDeadline]
  )

  if (!cutoffAt || !processingDeadline) return null

  const { isCounterBidPhase, cutoffFraction, elapsedFraction } = phase
  const cutoffPct = `${cutoffFraction * 100}%`
  const elapsedPct = `${elapsedFraction * 100}%`

  const summary = isCounterBidPhase
    ? `Counter-bid phase. New bids closed ${formatDeadlineShort(cutoffAt)}. Bids process ${formatDeadlineShort(processingDeadline)}.`
    : `Open bidding. New bids close ${formatDeadlineShort(cutoffAt)}, in ${formatTimeRemaining(cutoffAt)}.`

  return (
    <div className="mt-4 pt-4 border-t border-border" data-testid="bid-week-timeline">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <p className="text-foreground-muted text-xs uppercase tracking-wide">Bidding Week</p>
        <p
          className={`text-xs font-medium ${isCounterBidPhase ? 'text-gold' : 'text-foreground-secondary'}`}
          data-testid="bid-phase-label"
        >
          {isCounterBidPhase
            ? 'Counter bids only'
            : `New bids close in ${formatTimeRemaining(cutoffAt)}`}
        </p>
      </div>

      {/* The bar is decorative -- the labels below carry the same information
          for anyone not reading it visually. */}
      <div
        className="relative h-1.5 rounded-full bg-elevated overflow-hidden"
        role="img"
        aria-label={summary}
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
            className={`text-xs truncate ${isCounterBidPhase ? 'text-foreground-muted' : 'text-foreground-secondary'}`}
          >
            Open bidding{' '}
            <span className="text-foreground-muted">
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
            className={`text-xs truncate ${isCounterBidPhase ? 'text-foreground-secondary' : 'text-foreground-muted'}`}
          >
            Counter bids{' '}
            <span className="text-foreground-muted">
              to {formatDeadlineShort(processingDeadline)}
            </span>
          </p>
        </div>
      </div>

      {isCounterBidPhase && (
        <p className="mt-2.5 text-xs text-foreground-muted animate-fade-in">
          Raise or counter bids on movies already in play. Movies nobody has bid on reopen after
          this week&apos;s bids are processed, and bids placed now can&apos;t be withdrawn.
        </p>
      )}
    </div>
  )
}
