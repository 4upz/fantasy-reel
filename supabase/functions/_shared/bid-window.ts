/**
 * Where the current bidding cycle sits relative to its new-bid cutoff.
 *
 * The weekly cycle runs to `get_next_processing_deadline()` (Saturday 8pm UTC).
 * `leagues.new_bid_cutoff_hours` places a cutoff that many hours before it --
 * 48 by default, i.e. Thursday 8pm UTC -- splitting the week in two:
 *
 *   open phase        no restrictions; bid on anything
 *   counter-bid phase raises and counters only, on movies already contested;
 *                     no opening a bid on a movie nobody is bidding on, and no
 *                     cancelling
 *
 * The arithmetic lives here as a pure function so place-bid,
 * place-counterpick-bid, both cancel functions and the cutoff announcement job
 * cannot drift on where the boundary sits, and so the boundary can be tested
 * without a database. The refusal messages are shared for the same reason:
 * four functions enforcing one rule should say one thing.
 */

/** Default cutoff: 48h before Saturday 8pm UTC lands on Thursday 8pm UTC. */
export const DEFAULT_NEW_BID_CUTOFF_HOURS = 48

/** 0 disables the cutoff -- the league keeps unrestricted bidding all week. */
export const MIN_NEW_BID_CUTOFF_HOURS = 0

/**
 * Leaves at least 24 hours of open bidding in the 168-hour cycle, so the window
 * can never be configured shut. Mirrors the DB check constraint on
 * leagues.new_bid_cutoff_hours.
 */
export const MAX_NEW_BID_CUTOFF_HOURS = 144

export interface BidWindow {
  /** The weekly deadline this cycle resolves on. */
  processingDeadline: Date
  /** When new bids stop being accepted, or null when the cutoff is disabled. */
  cutoffAt: Date | null
  /** True once the cutoff has passed: raises and counters only. */
  isCounterBidPhase: boolean
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Resolve the phase for a cycle ending at `processingDeadline`.
 *
 * `cutoffHours` comes straight off the league row; null/undefined/0 (and any
 * non-finite value that somehow got past the DB constraint) mean "disabled",
 * which yields a null `cutoffAt` and an open phase forever. Treating bad input
 * as disabled rather than throwing is deliberate: a malformed config should
 * degrade to today's behavior, not lock a league out of bidding.
 *
 * The boundary is inclusive -- at exactly the cutoff instant the counter-bid
 * phase has begun. A bid landing on the same millisecond as the deadline is
 * late, matching how process-bids treats `<=` on its own deadlines.
 */
export function computeBidWindow(
  processingDeadline: string | Date,
  cutoffHours: number | null | undefined,
  now: Date = new Date(),
): BidWindow {
  const deadline =
    processingDeadline instanceof Date ? processingDeadline : new Date(processingDeadline)

  if (
    cutoffHours == null ||
    !Number.isFinite(cutoffHours) ||
    cutoffHours <= 0 ||
    Number.isNaN(deadline.getTime())
  ) {
    return { processingDeadline: deadline, cutoffAt: null, isCounterBidPhase: false }
  }

  const cutoffAt = new Date(deadline.getTime() - cutoffHours * HOUR_MS)

  return {
    processingDeadline: deadline,
    cutoffAt,
    isCounterBidPhase: cutoffAt.getTime() <= now.getTime(),
  }
}

/**
 * Whether a bid may be cancelled right now.
 *
 * Two separate locks, and the second is not redundant. Once the cycle rolls
 * over at Saturday 8pm the *next* cutoff is days away, so `isCounterBidPhase`
 * goes false again -- but a bid held open past its own deadline by a rival's
 * counter window is still awaiting resolution by the hourly process-bids run.
 * Without the deadline check a team could bait a bidding war all week and pull
 * out in that gap, which is exactly when withdrawing pays best.
 */
export function isBidCancellable(
  bidProcessingDeadline: string | Date | null | undefined,
  window: BidWindow,
  now: Date = new Date(),
): boolean {
  if (window.isCounterBidPhase) return false
  if (!bidProcessingDeadline) return true

  const deadline =
    bidProcessingDeadline instanceof Date ? bidProcessingDeadline : new Date(bidProcessingDeadline)
  if (Number.isNaN(deadline.getTime())) return true

  return deadline.getTime() > now.getTime()
}

/** Human-readable cutoff instant for error copy, e.g. "Thu, Aug 13, 8:00 PM UTC". */
function formatCutoff(cutoffAt: Date): string {
  return cutoffAt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/**
 * Refusal for opening a bid on an uncontested movie after the cutoff. States
 * what is still allowed, so the message doubles as an explanation of the rule.
 */
export function newBidClosedMessage(window: BidWindow): string {
  const when = window.cutoffAt ? ` at ${formatCutoff(window.cutoffAt)}` : ''
  return (
    `New bids closed${when}. ` +
    'Until this week\'s bids are processed you can only raise or counter bids on movies already being bid on.'
  )
}

/** Refusal for cancelling during the counter-bid phase. */
export function cancelClosedMessage(window: BidWindow): string {
  const when = window.cutoffAt ? ` at ${formatCutoff(window.cutoffAt)}` : ''
  return (
    `Bids are locked in for this week -- new bids closed${when}. ` +
    'You can still raise your bid, but it can no longer be withdrawn.'
  )
}

/** Refusal for cancelling a bid that is already awaiting resolution. */
export const CANCEL_IN_PROCESSING_MESSAGE =
  'This bid is already being processed and can no longer be cancelled.'
