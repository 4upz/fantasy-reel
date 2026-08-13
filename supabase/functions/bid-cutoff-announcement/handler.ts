/**
 * Core logic for bid-cutoff-announcement, kept separate from index.ts so unit
 * tests can import it without triggering index.ts's top-level Deno.serve()
 * (which would open a real listener as a side effect of the import).
 *
 * Hourly cron. Announces, once per league per bidding cycle, that the new-bid
 * cutoff has passed and the counter-bid phase has begun. One embed carries all
 * three things a manager needs at that moment:
 *
 *   1. the deadline has been reached, and what the rules are now
 *   2. every bid still live this week, pickup and counterpick together
 *   3. when those bids actually process
 *
 * Why hourly rather than a fixed Thursday 8pm job: leagues.new_bid_cutoff_hours
 * is configurable, so each league's cutoff sits at a different point in the
 * week. Both the weekly deadline and the offset are whole hours, so every
 * league's cutoff lands exactly on an hour boundary this job visits.
 *
 * Idempotency comes from bid_cutoff_announcements, keyed on (league,
 * processing_deadline) and written *before* dispatch. A rerun inside the same
 * cycle is a no-op; the next cycle carries a new deadline and announces again.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  buildLeagueUrl,
  buildEmbedAuthor,
  DiscordEmbed,
} from '../_shared/discord.ts'
import { computeBidWindow } from '../_shared/bid-window.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('bid-cutoff-announcement')

/** Discord allows 25; leave room for the "results" field and a truncation note. */
const MAX_MOVIE_FIELDS = 20

export interface BidCutoffAnnouncementResult {
  leagues_announced: number
  leagues_skipped: number
  bids_summarized: number
  failed: number
  errors: Array<{ league_id: string; error: string }>
}

interface LeagueRow {
  id: string
  name: string | null
  new_bid_cutoff_hours: number | null
}

/** One movie's contest, as it appears in the summary. */
interface ContestSummary {
  title: string
  highBid: number
  isCounterpick: boolean
}

/** Pickup bids carry a TMDb snapshot; counterpick bids join to the movies row. */
interface PickupBidRow {
  tmdb_id: number
  amount: number
  movie_data: { title?: string } | null
}

interface CounterpickBidRow {
  movie_id: string
  amount: number
  movies: { title?: string } | null
}

/**
 * Collapse a set of bid rows into one line per movie, carrying only the leading
 * amount. That amount is already public on the bidding page; everything about
 * *who* is bidding stays hidden until the round settles -- not just names but
 * how many teams are involved, since a count tells you how hard you would have
 * to push. process-bids names the winner and the beaten teams afterwards.
 *
 * The dedupe by movie is part of that guarantee, not just tidiness: one field
 * per bid rather than per movie would let anyone count the rows and recover the
 * number of bidders.
 */
function summarizeContests(
  pickupBids: PickupBidRow[],
  counterpickBids: CounterpickBidRow[],
): ContestSummary[] {
  const byKey = new Map<string, ContestSummary>()

  const add = (key: string, title: string, amount: number, isCounterpick: boolean) => {
    const existing = byKey.get(key)
    if (existing) {
      existing.highBid = Math.max(existing.highBid, amount)
      return
    }
    byKey.set(key, { title, highBid: amount, isCounterpick })
  }

  for (const bid of pickupBids) {
    add(`p:${bid.tmdb_id}`, bid.movie_data?.title ?? `Movie #${bid.tmdb_id}`, bid.amount, false)
  }
  for (const bid of counterpickBids) {
    add(`c:${bid.movie_id}`, bid.movies?.title ?? 'Untitled', bid.amount, true)
  }

  // Loudest contest first: the biggest pots are what teams want to see.
  return [...byKey.values()].sort((a, b) => b.highBid - a.highBid)
}

export function buildCutoffEmbed(params: {
  leagueId: string
  leagueName: string
  contests: ContestSummary[]
  processingDeadline: Date
}): DiscordEmbed {
  const { leagueId, leagueName, contests, processingDeadline } = params
  // Discord renders <t:seconds:F> in the viewer's own timezone, and :R as a live
  // countdown. This has to be a field, not the footer -- footers don't render
  // timestamp markup.
  const unixSeconds = Math.floor(processingDeadline.getTime() / 1000)

  const shown = contests.slice(0, MAX_MOVIE_FIELDS)
  const hidden = contests.length - shown.length

  const movieFields = shown.map((contest) => ({
    name: `${contest.isCounterpick ? '🎯 ' : ''}${contest.title}`,
    value: `High bid $${contest.highBid}`,
    inline: true,
  }))

  const description = contests.length > 0
    ? 'No new movies can be added to this week\'s bidding. You can still raise your ' +
      'own bid or counter another team\'s on anything below — and bids can no longer be withdrawn.'
    : 'No bids were placed this week, so there is nothing to counter. Bidding reopens ' +
      'for all movies once this week\'s window closes.'

  return {
    author: buildEmbedAuthor(leagueName, leagueId),
    title: '🔒 New bids are closed',
    description,
    color: DISCORD_COLORS.yellow,
    fields: [
      ...movieFields,
      ...(hidden > 0
        ? [{ name: '​', value: `…and ${hidden} more on the bidding page`, inline: false }]
        : []),
      {
        name: contests.length > 0 ? 'Counter bidding closes' : 'Bidding reopens',
        value: `<t:${unixSeconds}:F> (<t:${unixSeconds}:R>)`,
        inline: false,
      },
    ],
    footer: { text: leagueName },
    url: buildLeagueUrl(leagueId, '/bidding'),
  }
}

export async function runBidCutoffAnnouncement(
  serviceClient: SupabaseClient,
  now: Date = new Date(),
  targetLeagueId?: string,
): Promise<BidCutoffAnnouncementResult> {
  const result: BidCutoffAnnouncementResult = {
    leagues_announced: 0,
    leagues_skipped: 0,
    bids_summarized: 0,
    failed: 0,
    errors: [],
  }

  const { data: deadlineData, error: deadlineError } = await serviceClient.rpc(
    'get_next_processing_deadline',
  )
  if (deadlineError || !deadlineData) {
    throw new Error(`Failed to read processing deadline: ${deadlineError?.message ?? 'no value'}`)
  }
  const processingDeadline = new Date(deadlineData as string)

  let leagueQuery = serviceClient
    .from('leagues')
    .select('id, name, new_bid_cutoff_hours')
    .eq('status', 'active')
  if (targetLeagueId) leagueQuery = leagueQuery.eq('id', targetLeagueId)

  const { data: leagues, error: leaguesError } = await leagueQuery
  if (leaguesError) {
    throw new Error(`Failed to fetch active leagues: ${leaguesError.message}`)
  }

  for (const league of (leagues ?? []) as LeagueRow[]) {
    const window = computeBidWindow(processingDeadline, league.new_bid_cutoff_hours, now)

    // Nothing to announce for a league with the cutoff disabled, or one whose
    // cutoff is still ahead of it.
    if (!window.isCounterBidPhase) {
      result.leagues_skipped++
      continue
    }

    try {
      // Claim the cycle before sending. On a concurrent or repeated run the
      // unique index rejects the second insert, so at most one announcement
      // goes out even if two workers reach this line together.
      const { error: claimError } = await serviceClient
        .from('bid_cutoff_announcements')
        .insert({
          league_id: league.id,
          processing_deadline: processingDeadline.toISOString(),
        })

      if (claimError) {
        // 23505 = unique violation: already announced for this cycle.
        if ((claimError as { code?: string }).code === '23505') {
          result.leagues_skipped++
          continue
        }
        throw claimError
      }

      const [pickupResult, counterpickResult] = await Promise.all([
        serviceClient
          .from('pickup_bids')
          .select('tmdb_id, amount, movie_data')
          .eq('league_id', league.id)
          .in('status', ['active', 'outbid']),
        serviceClient
          .from('counterpick_bids')
          .select('movie_id, amount, movies(title)')
          .eq('league_id', league.id)
          .in('status', ['active', 'outbid']),
      ])

      if (pickupResult.error) throw pickupResult.error
      if (counterpickResult.error) throw counterpickResult.error

      const contests = summarizeContests(
        (pickupResult.data ?? []) as PickupBidRow[],
        (counterpickResult.data ?? []) as CounterpickBidRow[],
      )

      await sendDiscordNotification(serviceClient, {
        leagueId: league.id,
        category: 'bids',
        embeds: [
          buildCutoffEmbed({
            leagueId: league.id,
            leagueName: league.name ?? 'League',
            contests,
            processingDeadline,
          }),
        ],
        // Worth a ping: this is the moment the rules change for everyone, and
        // it is the last call to get into a contest.
        mentionRole: true,
      })

      result.leagues_announced++
      result.bids_summarized += contests.length
    } catch (err) {
      result.failed++
      result.errors.push({
        league_id: league.id,
        error: err instanceof Error ? err.message : String(err),
      })
      log.error('Failed to announce bid cutoff', {
        league_id: league.id,
        error: serializeError(err),
      })
    }
  }

  return result
}
