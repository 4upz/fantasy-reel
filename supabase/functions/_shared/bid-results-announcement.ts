/**
 * The bids-channel post reporting how every bid a processing run settled
 * ended -- won, outbid, couldn't be honored (and why), or cancelled -- naming
 * the team, so the league sees each result, not just the awards.
 *
 * Pure, like the other announcement builders, so the wording and Discord's size
 * limits are testable without a webhook.
 */

import type { BidLossReason, VoidReasonCode } from './bid-resolution.ts'
import { buildEmbedAuthor, buildLeagueUrl, DISCORD_COLORS, type DiscordEmbed } from './discord.ts'

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
}

// Discord rejects an embed with more than 25 fields, a field name over 256
// characters or a value over 1024, and a message over 6000 characters in
// total. Each message here carries one embed, kept safely under that cap.
const MAX_FIELDS = 25
const MAX_FIELD_NAME = 256
const MAX_FIELD_VALUE = 1024
const MAX_EMBED_CHARS = 5500

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
  movie_dropped: 'the movie was dropped by its holder',
  target_owned: 'the movie was traded to the bidder',
  target_missing: 'the targeted holding no longer exists',
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
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
  return movie.bids.some((bid) => bid.outcome.kind === 'won')
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
  const suffix = awarded ? '' : ' — not awarded'

  return {
    name: `${clip(movie.title, MAX_FIELD_NAME - suffix.length)}${suffix}`,
    value: clip(lines.join('\n'), MAX_FIELD_VALUE),
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
}): DiscordEmbed[][] {
  const { leagueId, leagueName, kind, movies } = params
  if (movies.length === 0) return []

  const { title, noun } = COPY[kind]
  const awardedCount = movies.filter(isAwarded).length
  const notAwardedCount = movies.length - awardedCount
  const description = `${awardedCount} ${noun}${awardedCount === 1 ? '' : 's'} awarded` +
    (notAwardedCount > 0 ? ` · ${notAwardedCount} not awarded` : '')

  // Plain awards first, so they sit together as a grid above the explanations.
  const fields = movies
    .map((movie) => movieField(movie, kind))
    .sort((a, b) => Number(b.inline) - Number(a.inline))

  // Budget each embed's fields around the largest header any of them carries.
  const fieldBudget = MAX_EMBED_CHARS -
    (`${title} (continued)`.length + description.length + 2 * leagueName.length)

  const batches: typeof fields[] = [[]]
  let batchChars = 0
  for (const field of fields) {
    const size = field.name.length + field.value.length
    const batch = batches[batches.length - 1]
    if (batch.length === MAX_FIELDS || (batch.length > 0 && batchChars + size > fieldBudget)) {
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
