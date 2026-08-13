import type {
  BidHistoryEntry,
  BidHistoryResult,
  BidHistoryRound,
  CounterpickBid,
  PickupBid,
} from '@/types'
import { groupBy } from './utils'

/**
 * Bids on the same movie belong to the same contest when their processing
 * deadlines sit within one weekly processing period of each other.
 *
 * Deadlines are stamped at placement (get_next_processing_deadline) and never
 * rewritten, so a contest held open past its Saturday - which happens whenever
 * an outbid team still has a counter window running - ends up with its late
 * counter carrying the *following* Saturday. Both bids resolve together even
 * though their deadlines differ by a week, so keying rounds off the raw
 * deadline would tear one contest in half. Clustering on this window keeps it
 * whole while still separating a movie that is dropped and contested again
 * weeks later.
 */
const CONTEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** A settled bid from either table, flattened so one routine can group both. */
interface ResolvedBid {
  kind: 'pickup' | 'counterpick'
  movieKey: string
  bidId: string
  teamId: string
  amount: number
  won: boolean
  processingDeadline: string
  title: string
  posterUrl: string | null
  releaseDate: string | null
  targetTeamId?: string
}

function fromPickupBid(bid: PickupBid): ResolvedBid {
  return {
    kind: 'pickup',
    movieKey: `pickup:${bid.tmdb_id}`,
    bidId: bid.id,
    teamId: bid.team_id,
    amount: bid.amount,
    won: bid.status === 'won',
    processingDeadline: bid.processing_deadline,
    title: bid.movie_data?.title ?? 'Unknown movie',
    posterUrl: bid.movie_data?.poster_url ?? null,
    releaseDate: bid.movie_data?.release_date ?? null,
  }
}

function fromCounterpickBid(bid: CounterpickBid): ResolvedBid {
  return {
    kind: 'counterpick',
    movieKey: `counterpick:${bid.movie_id}`,
    bidId: bid.id,
    teamId: bid.team_id,
    amount: bid.amount,
    won: bid.status === 'won',
    processingDeadline: bid.processing_deadline,
    title: bid.movies?.title ?? 'Unknown movie',
    posterUrl: bid.movies?.poster_url ?? null,
    releaseDate: bid.movies?.release_date ?? null,
    targetTeamId: bid.target_team_id,
  }
}

/** A run of bids on one movie that were processed together. */
interface Contest {
  bids: ResolvedBid[]
  /** When the contest actually settled: the latest deadline it carried. */
  settledAt: number
  hasWinner: boolean
}

/**
 * Splits one movie's settled bids into the separate contests they belong to.
 * A bid opens a new contest when it falls outside the current one's window, or
 * when the current contest already has a winner and this bid won too - two wins
 * on one movie can only mean it was dropped and picked up again.
 */
function splitIntoContests(bids: ResolvedBid[]): Contest[] {
  const byDeadline = [...bids].sort((a, b) =>
    a.processingDeadline.localeCompare(b.processingDeadline)
  )

  const contests: Contest[] = []
  for (const bid of byDeadline) {
    const settledAt = new Date(bid.processingDeadline).getTime()
    const current = contests[contests.length - 1]
    const startsNewContest =
      !current ||
      settledAt - current.settledAt > CONTEST_WINDOW_MS ||
      (current.hasWinner && bid.won)

    if (startsNewContest) {
      contests.push({ bids: [bid], settledAt, hasWinner: bid.won })
    } else {
      current.bids.push(bid)
      current.settledAt = Math.max(current.settledAt, settledAt)
      current.hasWinner = current.hasWinner || bid.won
    }
  }
  return contests
}

function toEntry(bid: ResolvedBid): BidHistoryEntry {
  return { bidId: bid.bidId, teamId: bid.teamId, amount: bid.amount }
}

function toResult(contest: Contest): BidHistoryResult {
  const winningBid = contest.bids.find((bid) => bid.won) ?? null
  const losers = contest.bids
    .filter((bid) => !bid.won)
    .sort((a, b) => b.amount - a.amount)
  // Every bid in a contest describes the same movie, so any of them can name it.
  const [sample] = contest.bids

  return {
    kind: sample.kind,
    id: `${sample.movieKey}@${new Date(contest.settledAt).toISOString()}`,
    title: sample.title,
    posterUrl: sample.posterUrl,
    releaseDate: sample.releaseDate,
    winner: winningBid ? toEntry(winningBid) : null,
    losers: losers.map(toEntry),
    targetTeamId: sample.targetTeamId,
  }
}

/** The winning price, or the top losing bid when a contest produced no winner. */
function headlineAmount(result: BidHistoryResult): number {
  return result.winner?.amount ?? result.losers[0]?.amount ?? 0
}

/**
 * Turns settled bids into rounds for the history board: newest round first, and
 * within a round the priciest contest first so the headline deals lead.
 *
 * Callers pass only bids that reached 'won' or 'lost' - anything still live, or
 * cancelled before processing, has no result to report.
 */
export function groupBidHistory(
  pickupBids: PickupBid[],
  counterpickBids: CounterpickBid[]
): BidHistoryRound[] {
  const resolved = [
    ...pickupBids.map(fromPickupBid),
    ...counterpickBids.map(fromCounterpickBid),
  ]

  const results: { result: BidHistoryResult; settledAt: number }[] = []
  for (const [, movieBids] of groupBy(resolved, (bid) => bid.movieKey)) {
    for (const contest of splitIntoContests(movieBids)) {
      results.push({ result: toResult(contest), settledAt: contest.settledAt })
    }
  }

  // Round by calendar date rather than exact timestamp: contests held over a
  // week land on the same Saturday but not always the same instant, and a
  // reader thinks in days anyway.
  const rounds = groupBy(results, ({ settledAt }) =>
    new Date(settledAt).toISOString().slice(0, 10)
  )

  return [...rounds.entries()]
    .map(([date, entries]) => ({
      date,
      results: entries
        .sort((a, b) => headlineAmount(b.result) - headlineAmount(a.result))
        .map(({ result }) => result),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Names a round by the day it processed, e.g. "Aug 9, 2026". Formatted in UTC
 * to match the date the round was keyed on, so the header can never disagree
 * with the grouping by a day.
 */
export function formatRoundDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
