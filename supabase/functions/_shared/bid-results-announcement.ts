/**
 * The bids-channel post reporting how every bid a processing run settled
 * ended -- won, outbid, couldn't be honored (and why), or cancelled -- naming
 * the team, so the league sees each result, not just the awards.
 *
 * Pure, like the other announcement builders, so the wording and Discord's size
 * limits are testable without a webhook.
 */

import type { BidLossReason, VoidReasonCode } from './bid-resolution.ts'
import {
  buildEmbedAuthor,
  buildLeagueUrl,
  clipText,
  DISCORD_COLORS,
  DISCORD_MAX_EMBED_FIELDS,
  DISCORD_MAX_FIELD_NAME,
  DISCORD_MAX_FIELD_VALUE,
  DISCORD_MAX_EMBED_CHARS,
  type DiscordEmbed,
} from './discord.ts'

/** How one bid ended. */
export type BidResultOutcome =
  | { kind: 'won' }
  | { kind: 'lost'; reason: BidLossReason }
  | { kind: 'cancelled'; reason: VoidReasonCode }

export type BidResultsKind = 'pickup' | 'counterpick'

export interface BidResult {
  teamName: string
  amount: number
  outcome: BidResultOutcome
}

/** One movie, and how each bid on it ended. */
export interface MovieResult {
  title: string
  bids: BidResult[]
  /** This run only reconciled losses left behind an earlier award. */
  previouslyAwarded?: boolean
}

// Each message carries one embed. Keep a deliberate 500-character safety
// margin below Discord's hard cap for the bid-results message budget.
const BID_RESULTS_EMBED_CHAR_BUDGET = DISCORD_MAX_EMBED_CHARS - 500

const COPY: Record<BidResultsKind, { title: string; noun: string; wonBy: string; noRoom: string }> = {
  pickup: {
    title: 'Bidding Results',
    noun: 'movie',
    wonBy: 'Won by',
    noRoom: 'no roster room',
  },
  counterpick: {
    title: 'Counterpick Bidding Results',
    noun: 'counterpick',
    wonBy: 'Counterpicked by',
    noRoom: 'no counterpick slots left',
  },
}

const CANCELLED_BECAUSE: Record<VoidReasonCode, string> = {
  movie_released: 'the movie released before processing',
  movie_scored: 'the movie got its score before processing',
  movie_dropped: 'the movie was dropped by its holder',
  target_owned: 'the movie was traded to the bidder',
  target_missing: 'the targeted holding no longer exists',
}

function describeBid(bid: BidResult, kind: BidResultsKind): string {
  const team = `**${bid.teamName}**`
  const { outcome } = bid

  if (outcome.kind === 'won') return `${COPY[kind].wonBy} ${team} for $${bid.amount}`
  if (outcome.kind === 'cancelled') {
    return `${team}'s $${bid.amount} bid was cancelled: ${CANCELLED_BECAUSE[outcome.reason]}`
  }
  if (outcome.reason === 'outbid') return `${team} was outbid ($${bid.amount})`

  const why = outcome.reason === 'no_slots'
    ? COPY[kind].noRoom
    : 'budget committed to higher-priority bids'
  return `${team}'s $${bid.amount} bid couldn't be honored: ${why}`
}

function isAwarded(movie: MovieResult): boolean {
  return movie.previouslyAwarded === true || movie.bids.some((bid) => bid.outcome.kind === 'won')
}

/**
 * One field per movie. A plain award stays the compact inline "Won by" cell it
 * always was; anything that needs explaining gets a full-width field, and a
 * movie nobody won says so in its name.
 */
function movieField(movie: MovieResult, kind: BidResultsKind) {
  const awarded = isAwarded(movie)
  const lines = [...movie.bids]
    .sort((a, b) => Number(b.outcome.kind === 'won') - Number(a.outcome.kind === 'won'))
    .map((bid) => describeBid(bid, kind))
  // Clip the title, never the verdict.
  const suffix = movie.previouslyAwarded ? ' — previously awarded' : awarded ? '' : ' — not awarded'

  return {
    name: `${clipText(movie.title, DISCORD_MAX_FIELD_NAME - suffix.length)}${suffix}`,
    value: clipText(lines.join('\n'), DISCORD_MAX_FIELD_VALUE),
    inline: awarded && lines.length === 1,
  }
}

/**
 * The results post for one league: one entry per message, to be sent in order.
 * A busy week splits across messages rather than dropping any bid's result.
 */
export function buildBidResultsMessages(params: {
  leagueId: string
  leagueName: string
  kind: BidResultsKind
  movies: MovieResult[]
  hasPendingBids?: boolean
}): DiscordEmbed[][] {
  const { leagueId, leagueName, kind, movies, hasPendingBids = false } = params
  if (movies.length === 0 && !hasPendingBids) return []

  const { title, noun } = COPY[kind]
  const awardedCount = movies.filter((movie) => !movie.previouslyAwarded && isAwarded(movie)).length
  const notAwardedCount = movies.filter((movie) => !isAwarded(movie)).length
  const previousCount = movies.filter((movie) => movie.previouslyAwarded).length
  const description = `${awardedCount} ${noun}${awardedCount === 1 ? '' : 's'} awarded` +
    (notAwardedCount > 0 ? ` · ${notAwardedCount} not awarded` : '') +
    (previousCount > 0 ? ` · ${previousCount} previously awarded` : '') +
    (hasPendingBids ? "\nSome bids are still pending; they'll be reported once processed." : '')

  // Plain awards first, so they sit together as a grid above the explanations.
  const fields = movies
    .map((movie) => movieField(movie, kind))
    .sort((a, b) => Number(b.inline) - Number(a.inline))

  // Budget each embed's fields around the largest header any of them carries.
  const fieldBudget = BID_RESULTS_EMBED_CHAR_BUDGET -
    (`${title} (continued)`.length + description.length + 2 * leagueName.length)

  const batches: typeof fields[] = [[]]
  let batchChars = 0
  for (const field of fields) {
    const size = field.name.length + field.value.length
    const batch = batches[batches.length - 1]
    if (batch.length === DISCORD_MAX_EMBED_FIELDS || (batch.length > 0 && batchChars + size > fieldBudget)) {
      batches.push([field])
      batchChars = size
    } else {
      batch.push(field)
      batchChars += size
    }
  }

  return batches.map((batchFields, index) => [{
    author: buildEmbedAuthor(leagueName, leagueId),
    title: index === 0 ? title : `${title} (continued)`,
    description: index === 0 ? description : undefined,
    fields: batchFields,
    color: awardedCount > 0 ? DISCORD_COLORS.green : DISCORD_COLORS.blue,
    footer: { text: leagueName },
    url: buildLeagueUrl(leagueId, '/bidding'),
  }])
}
