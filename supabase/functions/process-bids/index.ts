/**
 * Process Bids Edge Function
 *
 * Batch processing function for bid resolution, called by cron jobs.
 *
 * Two modes:
 * - 'weekly': Processes bids where processing_deadline <= now (Saturday 8pm UTC)
 * - 'extended': Processes bids where response_deadline has passed (hourly check for counter-bid windows)
 *
 * Processing logic:
 * 1. Group bids by movie (league_id + tmdb_id)
 * 2. Skip movies where any bid still has an open response window
 * 3. Find winner (highest amount, earliest created_at for ties)
 * 4. Create movie if it doesn't exist (from movie_data)
 * 5. Create pickup record
 * 6. Deduct from team budget
 * 7. Mark winner as 'won', others as 'lost'
 * 8. Send notifications to winner and losers
 */
// Trigger deploy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isUpcomingMovie } from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getBidWonEmailHtml, getBidWonEmailText } from '../_shared/email-templates/bid-won.ts'
import { getBidLostEmailHtml, getBidLostEmailText } from '../_shared/email-templates/bid-lost.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import {
  type CounterpickContest,
  type CounterpickLossReason,
  resolveCounterpickWinners,
} from '../_shared/counterpick-resolution.ts'
import {
  getCounterpickNoSlotsEmailHtml,
  getCounterpickNoSlotsEmailText,
} from '../_shared/email-templates/counterpick-no-slots.ts'

interface ProcessBidsRequest {
  mode?: 'weekly' | 'extended'
  league_id?: string
}

interface PickupBid {
  id: string
  league_id: string
  team_id: string
  tmdb_id: number
  movie_data: MovieData | null
  amount: number
  status: string
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

interface MovieData {
  title: string
  overview?: string | null
  poster_url: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids?: number[]
}

interface ProcessResult {
  tmdb_id: number
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

interface CounterpickBid {
  id: string
  league_id: string
  team_id: string
  movie_id: string
  target_team_id: string
  draft_pick_id: string | null
  pickup_id: string | null
  amount: number
  /** Team-chosen rank among its own pending bids; 1 is the one it wants most. */
  priority: number
  status: string
  created_at: string
  countered_at: string | null
  response_deadline: string | null
  processing_deadline: string
}

interface CounterpickProcessResult {
  movie_id: string
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

/** A movie whose processing failed, reported back in the response body. */
interface ProcessingError {
  movie_key: string
  error: string
}

interface BidResultSummary {
  league_id: string
  winner_team_id: string
  amount: number
  movie_title: string
}

// A winning bid that was voided at processing time because the movie released
// while the bid was pending (bids can sit for up to a week - see
// get_next_processing_deadline). Placement-time checks can't catch this since
// the movie may not have released yet when the bid was placed.
interface VoidedBidResult {
  bid_id: string
  league_id: string
  team_id: string
  amount: number
  movie_title: string
  reason: string
  tmdb_id?: number
  movie_id?: string
}

// deno-lint-ignore no-explicit-any
type ServiceClient = ReturnType<typeof createClient<any>>

interface DeadlinedBid {
  response_deadline: string | null
  processing_deadline: string
}

/**
 * Active bids on `table` whose window has closed.
 * - `weekly`: the regular processing deadline has passed.
 * - `extended`: the response window has passed, and only for bids that really
 *   were in counter-bid extra time -- a response_deadline at or before the
 *   processing deadline just means the regular weekly run will pick them up.
 */
async function fetchDueBids<T extends DeadlinedBid>(
  serviceClient: ServiceClient,
  table: 'pickup_bids' | 'counterpick_bids',
  mode: 'weekly' | 'extended',
  now: Date,
  leagueId?: string,
): Promise<{ bids: T[]; error: unknown }> {
  let query = serviceClient.from(table).select('*').eq('status', 'active')

  if (mode === 'weekly') {
    query = query.lte('processing_deadline', now.toISOString())
  } else {
    query = query.not('response_deadline', 'is', null).lt('response_deadline', now.toISOString())
  }

  if (leagueId) {
    query = query.eq('league_id', leagueId)
  }

  const { data, error } = await query
  if (error) return { bids: [], error }

  const bids = (data || []) as T[]
  if (mode === 'weekly') return { bids, error: null }

  return {
    bids: bids.filter(
      (bid) => new Date(bid.response_deadline!) > new Date(bid.processing_deadline)
    ),
    error: null,
  }
}

async function deductTeamBudget(
  serviceClient: ServiceClient,
  teamId: string,
  amount: number,
): Promise<void> {
  const { data: currentBudget, error: budgetFetchError } = await serviceClient
    .from('team_budgets')
    .select('remaining_budget, total_spent')
    .eq('team_id', teamId)
    .single()

  if (budgetFetchError || !currentBudget) {
    console.error(`Failed to fetch budget for team ${teamId}:`, budgetFetchError)
    return
  }

  const { error: budgetUpdateError } = await serviceClient
    .from('team_budgets')
    .update({
      remaining_budget: currentBudget.remaining_budget - amount,
      total_spent: currentBudget.total_spent + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('team_id', teamId)

  if (budgetUpdateError) {
    console.error(`Failed to update budget for team ${teamId}:`, budgetUpdateError)
  }
}

/** PostgREST `in` filters travel in the URI, so large sets are sent in batches. */
const ID_BATCH_SIZE = 150

/**
 * Runs `selectBatch` over `ids` in URI-safe chunks.
 *
 * A failed chunk is logged and skipped rather than aborting the run, so its ids
 * come back in `unreadIds`. "No rows" and "could not read" are otherwise
 * indistinguishable, and for slot accounting they mean opposite things -- so
 * callers must treat `unreadIds` as unknown rather than as zero.
 */
async function selectByIdBatches<T>(
  ids: string[],
  failureMessage: string,
  selectBatch: (batch: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; unreadIds: Set<string> }> {
  const rows: T[] = []
  const unreadIds = new Set<string>()

  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    const batch = ids.slice(i, i + ID_BATCH_SIZE)
    const { data, error } = await selectBatch(batch)
    if (error) {
      console.error(failureMessage, error)
      for (const id of batch) unreadIds.add(id)
      continue
    }
    rows.push(...(data ?? []))
  }

  return { rows, unreadIds }
}

/**
 * How many more bidding-phase counterpicks each team in `contests` may still win.
 *
 * Counts the `counterpicks` rows a team already holds, which is the same
 * accounting place-counterpick-bid applies when a bid is placed, so the two
 * cannot disagree about what "used a slot" means.
 *
 * Fails closed: a team whose league config or used-slot count could not be read
 * is given zero remaining slots. That withholds counterpicks for one run, which
 * a later run can still award -- whereas reading a failed count as "zero used"
 * would hand a team a full allowance on top of counterpicks it already holds,
 * which is the very over-cap outcome this function exists to prevent.
 */
async function getRemainingCounterpickSlots(
  serviceClient: ServiceClient,
  contests: CounterpickContest[],
): Promise<{ remaining: Map<string, number>; slotsByLeague: Map<string, number> }> {
  const leagueOfTeam = new Map<string, string>()
  for (const contest of contests) {
    const leagueId = contest.key.split(':')[0]
    for (const bid of contest.activeBids) leagueOfTeam.set(bid.team_id, leagueId)
  }

  const leagueIds = [...new Set(leagueOfTeam.values())]
  const teamIds = [...leagueOfTeam.keys()]

  const { rows: leagueRows } = await selectByIdBatches<
    { id: string; bidding_counterpick_slots: number | null }
  >(
    leagueIds,
    'Failed to load counterpick slot config:',
    (batch) =>
      serviceClient.from('leagues').select('id, bidding_counterpick_slots').in('id', batch),
  )

  // A league missing from the result -- unread or genuinely absent -- yields 0
  // slots below, so no separate handling is needed for its failure case.
  const slotsByLeague = new Map<string, number>(
    leagueRows.map((league) => [league.id, league.bidding_counterpick_slots ?? 0]),
  )

  const { rows: usedRows, unreadIds: uncountedTeamIds } = await selectByIdBatches<
    { counterpicker_team_id: string }
  >(
    teamIds,
    'Failed to count used counterpick slots:',
    (batch) =>
      serviceClient
        .from('counterpicks')
        .select('counterpicker_team_id')
        .eq('phase', 'bidding')
        .in('counterpicker_team_id', batch),
  )

  const usedByTeam = new Map<string, number>()
  for (const row of usedRows) {
    usedByTeam.set(row.counterpicker_team_id, (usedByTeam.get(row.counterpicker_team_id) ?? 0) + 1)
  }

  const remaining = new Map<string, number>()
  for (const [teamId, leagueId] of leagueOfTeam) {
    if (uncountedTeamIds.has(teamId)) {
      remaining.set(teamId, 0)
      continue
    }
    const slots = slotsByLeague.get(leagueId) ?? 0
    remaining.set(teamId, Math.max(0, slots - (usedByTeam.get(teamId) ?? 0)))
  }

  return { remaining, slotsByLeague }
}

/** The user behind a team, or null if the team has no reachable owner. */
async function getTeamUserId(
  serviceClient: ServiceClient,
  teamId: string,
): Promise<string | null> {
  const { data: team } = await serviceClient
    .from('teams')
    .select('league_participants(user_id)')
    .eq('id', teamId)
    .single()

  return (team?.league_participants as unknown as { user_id: string })?.user_id ?? null
}

/**
 * Notify a team's owner that their bid was voided at processing time because the
 * movie released while the bid was pending. Reuses the 'bid_lost' notification
 * type since no dedicated type exists for this case; `data.reason` is set to
 * 'movie_released' so the frontend can special-case the copy later.
 */
async function notifyVoidedBidder(
  serviceClient: ServiceClient,
  bid: { id: string; league_id: string; team_id: string; amount: number },
  movieTitle: string,
  reason: string,
  extraData: Record<string, unknown>,
): Promise<void> {
  const bidderUserId = await getTeamUserId(serviceClient, bid.team_id)
  if (!bidderUserId) return

  await serviceClient.from('notifications').insert({
    user_id: bidderUserId,
    league_id: bid.league_id,
    type: 'bid_lost',
    title: `Bid cancelled for ${movieTitle}`,
    body: `${movieTitle} was released before your bid of $${bid.amount} could be processed. Your bid was cancelled and your budget was not charged.`,
    data: {
      bid_id: bid.id,
      amount: bid.amount,
      reason: 'movie_released',
      release_check_reason: reason,
      ...extraData,
    },
  })
}

async function getRecipient(
  serviceClient: ServiceClient,
  userId: string,
): Promise<{ name: string; email: string | undefined }> {
  const [{ data: profile }, { data: userData }] = await Promise.all([
    serviceClient.from('profiles').select('display_name').eq('user_id', userId).single(),
    serviceClient.auth.admin.getUserById(userId),
  ])

  return {
    name: profile?.display_name || 'Fantasy Manager',
    email: userData?.user?.email,
  }
}

function appBaseUrl(): string {
  return Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
}

async function notifyCounterpickWinner(
  serviceClient: ServiceClient,
  winner: CounterpickBid,
  movieTitle: string,
  movieId: string,
): Promise<void> {
  const userId = await getTeamUserId(serviceClient, winner.team_id)
  if (!userId) return

  await serviceClient.from('notifications').insert({
    user_id: userId,
    league_id: winner.league_id,
    type: 'bid_won',
    title: `Counterpick won: ${movieTitle}!`,
    body: `Your bid of $${winner.amount} won the counterpick on ${movieTitle}.`,
    data: {
      bid_id: winner.id,
      movie_id: movieId,
      amount: winner.amount,
      bid_type: 'counterpick',
    },
  })

  const { name, email } = await getRecipient(serviceClient, userId)
  if (!email) return

  const emailData = {
    recipientName: name,
    movieTitle: `${movieTitle} (counterpick)`,
    winningAmount: winner.amount,
    leagueUrl: `${appBaseUrl()}/league/${winner.league_id}`,
  }

  sendEmail({
    to: email,
    subject: `Counterpick won: ${movieTitle}!`,
    html: getBidWonEmailHtml(emailData),
    text: getBidWonEmailText(emailData),
  }).catch((err) => console.error('Failed to send counterpick bid won email:', err))
}

/**
 * Tell a losing bidder what happened, distinguishing the two ways to lose. A bid
 * beaten on price gets the outbid message; one that led but had nowhere to go
 * gets told its slots were full, since "you were outbid" would be untrue and the
 * fix (reordering bid priorities) is different.
 */
async function notifyCounterpickLoser(
  serviceClient: ServiceClient,
  params: {
    loserBid: CounterpickBid
    movieTitle: string
    movieId: string
    winner: CounterpickBid | undefined
    reason: CounterpickLossReason
    slots: number
  },
): Promise<void> {
  const { loserBid, movieTitle, movieId, winner, reason, slots } = params

  const userId = await getTeamUserId(serviceClient, loserBid.team_id)
  if (!userId) return

  const outOfSlots = reason === 'no_slots'

  await serviceClient.from('notifications').insert({
    user_id: userId,
    league_id: loserBid.league_id,
    type: 'bid_lost',
    title: outOfSlots
      ? `Counterpick slots full: ${movieTitle}`
      : `Counterpick bid unsuccessful for ${movieTitle}`,
    body: outOfSlots
      ? `Your $${loserBid.amount} bid on ${movieTitle} would have won, but your higher-priority bids had already filled all ${slots} of your counterpick slots.`
      : `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner?.amount ?? 'more'}.`,
    data: {
      bid_id: loserBid.id,
      movie_id: movieId,
      winning_amount: winner?.amount ?? null,
      bid_type: 'counterpick',
      loss_reason: reason,
    },
  })

  const { name, email } = await getRecipient(serviceClient, userId)
  if (!email) return

  const leagueUrl = `${appBaseUrl()}/league/${loserBid.league_id}`

  if (outOfSlots) {
    const emailData = {
      recipientName: name,
      movieTitle,
      yourBidAmount: loserBid.amount,
      slotsUsed: slots,
      leagueUrl,
    }
    sendEmail({
      to: email,
      subject: `Counterpick slots full: ${movieTitle}`,
      html: getCounterpickNoSlotsEmailHtml(emailData),
      text: getCounterpickNoSlotsEmailText(emailData),
    }).catch((err) => console.error('Failed to send counterpick no-slots email:', err))
    return
  }

  // No winner means there is no losing amount to quote, so the in-app
  // notification above stands on its own rather than sending a misleading email.
  if (!winner) return

  const emailData = {
    recipientName: name,
    movieTitle: `${movieTitle} (counterpick)`,
    yourBidAmount: loserBid.amount,
    winningAmount: winner.amount,
    leagueUrl,
  }
  sendEmail({
    to: email,
    subject: `Counterpick bid unsuccessful for ${movieTitle}`,
    html: getBidLostEmailHtml(emailData),
    text: getBidLostEmailText(emailData),
  }).catch((err) => console.error('Failed to send counterpick bid lost email:', err))
}

/**
 * Load every counterpick contest that is ready to resolve.
 *
 * `dueBids` only says which movies have a bid past its deadline; each of those
 * movies is re-read in full because an 'outbid' entry with an open response
 * window can still counter, which keeps the movie unsettled.
 *
 * A movie whose bids cannot be loaded is recorded in `errors` and skipped; the
 * rest still resolve.
 */
async function loadSettledCounterpickContests(
  serviceClient: ServiceClient,
  dueBids: CounterpickBid[],
  now: Date,
  errors: ProcessingError[],
): Promise<{ contests: CounterpickContest[]; bidsByContest: Map<string, CounterpickBid[]> }> {
  const contests: CounterpickContest[] = []
  const bidsByContest = new Map<string, CounterpickBid[]>()
  const contestedKeys = new Set(dueBids.map((bid) => `${bid.league_id}:${bid.movie_id}`))

  for (const key of contestedKeys) {
    const [leagueId, movieId] = key.split(':')

    try {
      const { data: allBidsForMovie, error: bidsError } = await serviceClient
        .from('counterpick_bids')
        .select('*')
        .eq('league_id', leagueId)
        .eq('movie_id', movieId)
        .in('status', ['active', 'outbid'])

      if (bidsError) throw bidsError

      const bids = (allBidsForMovie || []) as CounterpickBid[]

      // An outbid team can still counter, so this movie is not settled yet.
      const hasOpenWindow = bids.some(
        (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
      )
      if (hasOpenWindow) continue

      const activeBids = bids.filter((bid) => bid.status === 'active')
      if (activeBids.length === 0) continue

      contests.push({ key, activeBids })
      bidsByContest.set(key, bids)
    } catch (error) {
      console.error(`Error loading counterpick bids for ${key}:`, error)
      errors.push({
        movie_key: key,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { contests, bidsByContest }
}

/**
 * Drop every contest whose target movie has already released, cancelling all of
 * that contest's bids.
 *
 * Bids can sit pending for up to a week, so a movie that was legitimately
 * upcoming at placement time may have released by now. The `movies` row is the
 * authoritative release date here -- unlike the client-supplied `movie_data` a
 * pickup bid carries.
 *
 * This runs before slot resolution on purpose: a contest that can never be
 * awarded must not consume one of the bidder's scarce counterpick slots, which
 * is exactly what would happen if it were resolved first and voided after.
 */
async function voidReleasedCounterpickContests(
  serviceClient: ServiceClient,
  contests: CounterpickContest[],
  bidsByContest: Map<string, CounterpickBid[]>,
  voided: VoidedBidResult[],
): Promise<CounterpickContest[]> {
  const movieIds = [...new Set(contests.map(({ key }) => key.split(':')[1]))]

  const { rows: movies } = await selectByIdBatches<
    { id: string; title: string; release_date: string | null }
  >(
    movieIds,
    'Failed to read movies for the counterpick release check:',
    (batch) => serviceClient.from('movies').select('id, title, release_date').in('id', batch),
  )
  const moviesById = new Map(movies.map((movie) => [movie.id, movie]))

  const surviving: CounterpickContest[] = []

  for (const contest of contests) {
    const [, movieId] = contest.key.split(':')
    const movie = moviesById.get(movieId)

    // A movie we could not read is left in place so the awarding loop reports it
    // as an error, rather than voiding real bids on the strength of a failed read.
    if (!movie) {
      surviving.push(contest)
      continue
    }

    const releaseCheck = isUpcomingMovie(movie.release_date)
    if (releaseCheck.valid) {
      surviving.push(contest)
      continue
    }

    const movieTitle = movie.title || `Movie ${movieId}`
    const reason = releaseCheck.reason ?? 'Movie has already been released'

    // Void every bid in the group, not just the leader: once the target has
    // released none of them can ever be honored, and a bid left 'active' with an
    // expired deadline would be reconsidered on every later run and would keep
    // rendering as live in the UI.
    const bidsToVoid = bidsByContest.get(contest.key) ?? []

    if (bidsToVoid.length > 0) {
      await serviceClient
        .from('counterpick_bids')
        .update({ status: 'cancelled' })
        .in('id', bidsToVoid.map((bid) => bid.id))
    }

    for (const bid of bidsToVoid) {
      await notifyVoidedBidder(serviceClient, bid, movieTitle, reason, {
        movie_id: movieId,
        bid_type: 'counterpick',
      })

      voided.push({
        bid_id: bid.id,
        league_id: bid.league_id,
        team_id: bid.team_id,
        amount: bid.amount,
        movie_title: movieTitle,
        reason,
        movie_id: movieId,
      })
    }

    console.log(
      `Voided ${bidsToVoid.length} counterpick bid(s) for ${movieTitle}: movie released before processing`
    )
  }

  return surviving
}

/**
 * Award every counterpick contest that is due and tell each losing bidder why.
 *
 * Contests are resolved together rather than one movie at a time. A team can
 * lead several at once, and only a combined view can stop it winning more
 * counterpicks than `leagues.bidding_counterpick_slots` allows (issue #24).
 */
async function processCounterpickBids(
  serviceClient: ServiceClient,
  dueBids: CounterpickBid[],
  now: Date,
  errors: ProcessingError[],
  voided: VoidedBidResult[],
): Promise<CounterpickProcessResult[]> {
  const results: CounterpickProcessResult[] = []
  if (dueBids.length === 0) return results

  const { contests: settledContests, bidsByContest } = await loadSettledCounterpickContests(
    serviceClient,
    dueBids,
    now,
    errors
  )
  if (settledContests.length === 0) return results

  const contests = await voidReleasedCounterpickContests(
    serviceClient,
    settledContests,
    bidsByContest,
    voided
  )
  if (contests.length === 0) return results

  const { remaining, slotsByLeague } = await getRemainingCounterpickSlots(serviceClient, contests)
  const { winners, lossReasons } = resolveCounterpickWinners(contests, remaining)

  for (const { key } of contests) {
    const [leagueId, movieId] = key.split(':')
    const winner = winners.get(key) as CounterpickBid | undefined
    const allBids = bidsByContest.get(key) ?? []

    try {
      const { data: movie, error: movieError } = await serviceClient
        .from('movies')
        .select('id, title, fantasy_points')
        .eq('id', movieId)
        .single()

      if (movieError || !movie) {
        console.error(`Movie not found for counterpick bid: ${movieId}`)
        errors.push({ movie_key: key, error: 'Movie not found for counterpick bid' })
        continue
      }

      const movieTitle = movie.title || `Movie ${movieId}`

      if (winner) {
        // Get pick_order: count existing counterpicks for this league with phase='bidding', add 1
        const { count: existingPickOrderCount } = await serviceClient
          .from('counterpicks')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('phase', 'bidding')

        // Create counterpick record
        const { error: counterpickError } = await serviceClient
          .from('counterpicks')
          .insert({
            league_id: leagueId,
            counterpicker_team_id: winner.team_id,
            target_team_id: winner.target_team_id,
            movie_id: winner.movie_id,
            // The winning bid carries exactly one of these (enforced by
            // counterpick_bids_exactly_one_source), so copying both across
            // satisfies the matching CHECK on `counterpicks`.
            draft_pick_id: winner.draft_pick_id,
            pickup_id: winner.pickup_id,
            pick_order: (existingPickOrderCount ?? 0) + 1,
            phase: 'bidding',
            fantasy_points: movie.fantasy_points != null ? -movie.fantasy_points : null,
          })

        if (counterpickError) {
          console.error(`Failed to create counterpick for ${movieTitle}:`, counterpickError)
          errors.push({ movie_key: key, error: 'Failed to create counterpick record' })
          continue
        }

        // Flag the source record as counterpicked. A counterpick target is held
        // either through the draft or through a pickup, and both tables carry a
        // counterpicked_by_team_id column.
        const sourceTable = winner.draft_pick_id ? 'draft_picks' : 'pickups'
        await serviceClient
          .from(sourceTable)
          .update({ counterpicked_by_team_id: winner.team_id })
          .eq('id', winner.draft_pick_id ?? winner.pickup_id)

        await deductTeamBudget(serviceClient, winner.team_id, winner.amount)

        // Mark winner as won
        await serviceClient
          .from('counterpick_bids')
          .update({ status: 'won' })
          .eq('id', winner.id)

        await notifyCounterpickWinner(serviceClient, winner, movieTitle, movieId)

        results.push({
          movie_id: winner.movie_id,
          league_id: winner.league_id,
          winner_team_id: winner.team_id,
          amount: winner.amount,
          movie_title: movieTitle,
        })

        console.log(
          `Processed counterpick bid for ${movieTitle}: winner team ${winner.team_id} with $${winner.amount}`
        )
      } else {
        console.log(`No counterpick awarded for ${movieTitle}: every bidder had filled its slots`)
      }

      // Mark all other bids for this movie as lost
      const loserBids = allBids.filter((bid) => bid.id !== winner?.id)
      const loserIds = loserBids.map((bid) => bid.id)

      if (loserIds.length > 0) {
        await serviceClient
          .from('counterpick_bids')
          .update({ status: 'lost' })
          .in('id', loserIds)
      }

      for (const loserBid of loserBids) {
        // The resolver only reports on bids it actually weighed. A bid that
        // never went active was outbid -- unless nothing won at all, in which
        // case the movie went unawarded for lack of slots.
        const reason = lossReasons.get(loserBid.id) ?? (winner ? 'outbid' : 'no_slots')
        await notifyCounterpickLoser(serviceClient, {
          loserBid,
          movieTitle,
          movieId,
          winner,
          reason,
          slots: slotsByLeague.get(leagueId) ?? 0,
        })
      }
    } catch (error) {
      console.error(`Error processing counterpick bids for ${key}:`, error)
      errors.push({
        movie_key: key,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}

async function sendBidResultsDiscordNotifications(
  serviceClient: ServiceClient,
  results: BidResultSummary[],
  embedTitle: string,
  itemLabel: string,
  fieldPrefix: string,
): Promise<void> {
  if (results.length === 0) return

  const resultsByLeague = new Map<string, BidResultSummary[]>()
  for (const result of results) {
    const existing = resultsByLeague.get(result.league_id) ?? []
    existing.push(result)
    resultsByLeague.set(result.league_id, existing)
  }

  const allTeamIds = [...new Set(results.map((r) => r.winner_team_id))]
  const allLeagueIds = [...resultsByLeague.keys()]

  const [{ data: teamsData }, { data: leaguesData }] = await Promise.all([
    serviceClient.from('teams').select('id, name').in('id', allTeamIds),
    serviceClient.from('leagues').select('id, name').in('id', allLeagueIds),
  ])

  const teamNameMap = new Map<string, string>()
  for (const t of teamsData ?? []) teamNameMap.set(t.id, t.name)

  const leagueNameMap = new Map<string, string>()
  for (const l of leaguesData ?? []) leagueNameMap.set(l.id, l.name)

  const discordPromises: Promise<void>[] = []
  for (const [leagueId, leagueResults] of resultsByLeague) {
    const leagueName = leagueNameMap.get(leagueId) ?? 'League'

    const fields = leagueResults.slice(0, 10).map((r) => ({
      name: r.movie_title,
      value: `${fieldPrefix} **${teamNameMap.get(r.winner_team_id) ?? 'A team'}** for $${r.amount}`,
      inline: true,
    }))

    discordPromises.push(
      sendDiscordNotification(serviceClient, {
        leagueId,
        category: 'bids',
        mentionRole: true,
        embeds: [{
          author: buildEmbedAuthor(leagueName, leagueId),
          title: embedTitle,
          description: `${leagueResults.length} ${itemLabel}${leagueResults.length === 1 ? '' : 's'} awarded`,
          fields,
          color: DISCORD_COLORS.green,
          footer: { text: leagueName },
          url: buildLeagueUrl(leagueId, '/bidding'),
        }],
      })
    )
  }

  await Promise.allSettled(discordPromises)
}

interface NotificationSummary {
  leagues_attempted: string[]
  channels_notified: number
  channels_queried: number
}

async function sendNoBidsDiscordNotifications(
  serviceClient: ServiceClient,
  excludeLeagueIds = new Set<string>(),
  targetLeagueId?: string
): Promise<NotificationSummary> {
  const summary: NotificationSummary = {
    leagues_attempted: [],
    channels_notified: 0,
    channels_queried: 0,
  }

  try {
    let query = serviceClient
      .from('discord_channels')
      .select('league_id')
      .eq('enabled', true)
      .eq('notify_bids', true)

    if (targetLeagueId) {
      query = query.eq('league_id', targetLeagueId)
    }

    const { data: allChannels, error: channelsError } = await query

    if (channelsError) {
      console.error('Error fetching discord channels:', channelsError)
      return summary
    }

    if (!allChannels || allChannels.length === 0) {
      console.log(`[process-bids] No enabled discord channels found for notify_bids`)
      return summary
    }

    summary.channels_queried = allChannels.length

    const activeLeagueIds = [...new Set(allChannels.map(ch => (ch as { league_id: string }).league_id))]
    const leaguesWithNoBids = activeLeagueIds.filter(id => !excludeLeagueIds.has(id))

    summary.leagues_attempted = leaguesWithNoBids

    // Count how many channels will be notified
    const { count } = await serviceClient
      .from('discord_channels')
      .select('*', { count: 'exact', head: true })
      .in('league_id', leaguesWithNoBids)
      .eq('enabled', true)
      .eq('notify_bids', true)
    
    summary.channels_notified = count ?? 0

    const noBidsPromises = leaguesWithNoBids.map(async (leagueId) => {
      const leagueName = await getLeagueName(serviceClient, leagueId)
      return sendDiscordNotification(serviceClient, {
        leagueId,
        category: 'bids',
        embeds: [{
          author: buildEmbedAuthor(leagueName, leagueId),
          title: 'Bidding Results',
          description: 'Bidding has concluded for this week. No bids were placed.',
          color: DISCORD_COLORS.blue,
          footer: { text: leagueName },
          url: buildLeagueUrl(leagueId, '/bidding'),
        }]
      })
    })

    await Promise.allSettled(noBidsPromises)
  } catch (err) {
    console.error('Failed to send "no bids" notifications:', err)
  }

  return summary
}


Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate requests using either the X-Cron-Secret header or the Service Role key
    const cronSecret = Deno.env.get('CRON_SECRET')
    const providedSecret = req.headers.get('X-Cron-Secret')
    const authHeader = req.headers.get('Authorization')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    let isAuthenticated = false

    // 1. Check if X-Cron-Secret matches CRON_SECRET (if configured)
    if (cronSecret && providedSecret === cronSecret) {
      isAuthenticated = true
    }

    // 2. Check if Authorization Bearer matches SUPABASE_SERVICE_ROLE_KEY
    if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthenticated = true
    }

    if (!isAuthenticated) {
      return errorResponse('Forbidden', 403)
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { mode = 'weekly', league_id }: ProcessBidsRequest = await req.json().catch(() => ({ mode: 'weekly' }))

    if (mode !== 'weekly' && mode !== 'extended') {
      return errorResponse('Mode must be "weekly" or "extended"', 400)
    }

    const now = new Date()

    const { bids: bidsToProcess, error: bidsError } = await fetchDueBids<PickupBid>(
      serviceClient,
      'pickup_bids',
      mode,
      now,
      league_id
    )

    if (bidsError) {
      console.error(`Failed to fetch ${mode} bids:`, bidsError)
      return errorResponse(
        mode === 'weekly' ? 'Failed to fetch bids' : 'Failed to fetch extended bids',
        500
      )
    }

    // No early return when there are no pickup bids: counterpick bids are resolved
    // further down and have their own deadlines, so bailing out here skipped them
    // entirely on any week without a pickup bid. The loops below are all no-ops on
    // empty input, and the "no bids placed" Discord notification still goes out at
    // the end for leagues that saw nothing at all.

    // One entry per contested movie (league_id + tmdb_id). Each movie's full bid
    // set is re-read below, so only the key is needed here.
    const contestedKeys = new Set(bidsToProcess.map((bid) => `${bid.league_id}:${bid.tmdb_id}`))

    const results: ProcessResult[] = []
    const errors: ProcessingError[] = []
    const voidedPickupResults: VoidedBidResult[] = []

    for (const key of contestedKeys) {
      const [leagueId, tmdbIdStr] = key.split(':')
      const tmdbId = parseInt(tmdbIdStr)

      try {
        // Check if any bids for this movie still have open response windows
        // (including outbid entries that might counter)
        const { data: allBidsForMovie } = await serviceClient
          .from('pickup_bids')
          .select('*')
          .eq('league_id', leagueId)
          .eq('tmdb_id', tmdbId)
          .in('status', ['active', 'outbid'])

        const hasOpenWindow = (allBidsForMovie || []).some(
          (bid) => bid.response_deadline && new Date(bid.response_deadline) > now
        )

        if (hasOpenWindow) {
          // Skip this movie - someone still has time to counter
          continue
        }

        // Find active bids only (outbid entries don't win)
        const activeBids = (allBidsForMovie || []).filter((b) => b.status === 'active')
        if (activeBids.length === 0) {
          continue
        }

        // Find the winner: highest amount, earliest created_at for ties
        activeBids.sort((a, b) => {
          if (b.amount !== a.amount) return b.amount - a.amount
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })

        const winner = activeBids[0]
        const movieTitle = winner.movie_data?.title || `Movie #${winner.tmdb_id}`

        // Create movie if it doesn't exist
        let movieId: string
        let movieReleaseDate: string | null
        const { data: existingMovie } = await serviceClient
          .from('movies')
          .select('id, release_date')
          .eq('tmdb_id', winner.tmdb_id)
          .single()

        if (existingMovie) {
          movieId = existingMovie.id
          movieReleaseDate = existingMovie.release_date
        } else if (winner.movie_data) {
          const { data: newMovie, error: movieError } = await serviceClient
            .from('movies')
            .insert({
              tmdb_id: winner.tmdb_id,
              title: winner.movie_data.title,
              overview: winner.movie_data.overview,
              poster_url: winner.movie_data.poster_url,
              release_date: winner.movie_data.release_date,
              popularity: winner.movie_data.popularity,
              vote_average: winner.movie_data.vote_average,
              status: 'upcoming',
            })
            .select('id, release_date')
            .single()

          if (movieError || !newMovie) {
            console.error(`Failed to create movie for ${movieTitle}:`, movieError)
            errors.push({ movie_key: key, error: 'Failed to create movie record' })
            continue
          }
          movieId = newMovie.id
          movieReleaseDate = newMovie.release_date
        } else {
          console.error(`No movie data for bid ${winner.id}`)
          errors.push({ movie_key: key, error: 'No movie data available' })
          continue
        }

        // Revalidate release date against the authoritative movies row. Bids can
        // sit pending for up to a week (see get_next_processing_deadline), so a
        // movie that was upcoming when the bid was placed may have released by
        // now. This recheck is authoritative for any movie that already had a
        // `movies` row. For a movie first seen at processing time (no prior row),
        // the row above was just created from the same client-supplied movie_data
        // that came with the bid, so this only re-validates that data against
        // itself - it does not independently verify it. Closing that gap would
        // need a TMDb round-trip at movie-creation time (draft-pick has the same
        // trust model); out of scope here.
        const releaseCheck = isUpcomingMovie(movieReleaseDate)
        if (!releaseCheck.valid) {
          const reason = releaseCheck.reason ?? 'Movie has already been released'

          // The movie has released, so no bid on it - winner or otherwise - can
          // ever be honored. Void the entire group, not just the winner, or the
          // losing bids strand as 'active' forever (they'd only surface again if
          // some other bid on the same released movie were ever re-evaluated).
          const bidsToVoid = allBidsForMovie || []
          const bidIdsToVoid = bidsToVoid.map((b) => b.id)

          await serviceClient
            .from('pickup_bids')
            .update({ status: 'cancelled' })
            .in('id', bidIdsToVoid)

          for (const bid of bidsToVoid) {
            await notifyVoidedBidder(serviceClient, bid, movieTitle, reason, {
              tmdb_id: bid.tmdb_id,
              movie_id: movieId,
            })

            voidedPickupResults.push({
              bid_id: bid.id,
              league_id: bid.league_id,
              team_id: bid.team_id,
              amount: bid.amount,
              movie_title: movieTitle,
              reason,
              tmdb_id: bid.tmdb_id,
              movie_id: movieId,
            })
          }

          console.log(`Voided ${bidIdsToVoid.length} pickup bid(s) for ${movieTitle}: movie released before processing`)
          continue
        }

        // Create pickup record
        const { error: pickupError } = await serviceClient.from('pickups').insert({
          league_id: winner.league_id,
          team_id: winner.team_id,
          movie_id: movieId,
          bid_id: winner.id,
          amount_paid: winner.amount,
        })

        if (pickupError) {
          console.error(`Failed to create pickup for ${movieTitle}:`, pickupError)
          errors.push({ movie_key: key, error: 'Failed to create pickup record' })
          continue
        }

        await deductTeamBudget(serviceClient, winner.team_id, winner.amount)

        // Mark winner as won
        await serviceClient
          .from('pickup_bids')
          .update({ status: 'won' })
          .eq('id', winner.id)

        // Mark all other bids for this movie as lost
        const loserBids = (allBidsForMovie || []).filter((b) => b.id !== winner.id)
        const loserIds = loserBids.map((b) => b.id)

        if (loserIds.length > 0) {
          await serviceClient
            .from('pickup_bids')
            .update({ status: 'lost' })
            .in('id', loserIds)
        }

        // Send notification to winner
        const winnerUserId = await getTeamUserId(serviceClient, winner.team_id)

        if (winnerUserId) {
          await serviceClient.from('notifications').insert({
            user_id: winnerUserId,
            league_id: winner.league_id,
            type: 'bid_won',
            title: `You won ${movieTitle}!`,
            body: `Your bid of $${winner.amount} won. ${movieTitle} has been added to your roster.`,
            data: {
              bid_id: winner.id,
              tmdb_id: winner.tmdb_id,
              movie_id: movieId,
              amount: winner.amount,
            },
          })

          // Send email to winner
          const { name, email } = await getRecipient(serviceClient, winnerUserId)

          if (email) {
            const emailData = {
              recipientName: name,
              movieTitle,
              winningAmount: winner.amount,
              leagueUrl: `${appBaseUrl()}/league/${winner.league_id}`,
            }
            sendEmail({
              to: email,
              subject: `You won ${movieTitle}!`,
              html: getBidWonEmailHtml(emailData),
              text: getBidWonEmailText(emailData),
            }).catch(err => console.error('Failed to send bid won email:', err))
          }
        }

        // Send notifications to losers
        for (const loserBid of loserBids) {
          const loserUserId = await getTeamUserId(serviceClient, loserBid.team_id)

          if (loserUserId) {
            await serviceClient.from('notifications').insert({
              user_id: loserUserId,
              league_id: loserBid.league_id,
              type: 'bid_lost',
              title: `Bid unsuccessful for ${movieTitle}`,
              body: `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner.amount}.`,
              data: {
                bid_id: loserBid.id,
                tmdb_id: loserBid.tmdb_id,
                winning_amount: winner.amount,
              },
            })

            // Send email to loser
            const { name, email } = await getRecipient(serviceClient, loserUserId)

            if (email) {
              const emailData = {
                recipientName: name,
                movieTitle,
                yourBidAmount: loserBid.amount,
                winningAmount: winner.amount,
                leagueUrl: `${appBaseUrl()}/league/${loserBid.league_id}`,
              }
              sendEmail({
                to: email,
                subject: `Bid unsuccessful for ${movieTitle}`,
                html: getBidLostEmailHtml(emailData),
                text: getBidLostEmailText(emailData),
              }).catch(err => console.error('Failed to send bid lost email:', err))
            }
          }
        }

        results.push({
          tmdb_id: winner.tmdb_id,
          league_id: winner.league_id,
          winner_team_id: winner.team_id,
          amount: winner.amount,
          movie_title: movieTitle,
        })

        console.log(`Processed bid for ${movieTitle}: winner team ${winner.team_id} with $${winner.amount}`)
      } catch (error) {
        console.error(`Error processing bids for ${key}:`, error)
        errors.push({
          movie_key: key,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // ========================================================================
    // COUNTERPICK BID PROCESSING
    // Process counterpick bids after pickup bids
    // ========================================================================

    const {
      bids: counterpickBidsToProcess,
      error: counterpickBidsError,
    } = await fetchDueBids<CounterpickBid>(serviceClient, 'counterpick_bids', mode, now, league_id)

    if (counterpickBidsError) {
      // Continue with pickup results even if counterpick fetch fails
      console.error(`Failed to fetch ${mode} counterpick bids:`, counterpickBidsError)
    }

    const voidedCounterpickResults: VoidedBidResult[] = []

    const counterpickResults = await processCounterpickBids(
      serviceClient,
      counterpickBidsToProcess,
      now,
      errors,
      voidedCounterpickResults
    )

    await sendBidResultsDiscordNotifications(serviceClient, results, 'Bidding Results', 'movie', 'Won by')
    await sendBidResultsDiscordNotifications(serviceClient, counterpickResults, 'Counterpick Bidding Results', 'counterpick', 'Counterpicked by')

    // If weekly run, check for leagues with no bids to send "no bids placed" notification
    let notificationSummary: NotificationSummary | undefined
    if (mode === 'weekly') {
      const leaguesWithBids = new Set([
        ...results.map(r => r.league_id),
        ...counterpickResults.map(cr => cr.league_id)
      ])
      notificationSummary = await sendNoBidsDiscordNotifications(serviceClient, leaguesWithBids, league_id)
    }

    // A run that awarded nothing but voided something did do work, so it must not
    // report "No bids to process" -- that message is reserved for a truly idle run.
    const voidedCount = voidedPickupResults.length + voidedCounterpickResults.length
    const nothingProcessed = results.length === 0 && counterpickResults.length === 0
    const voidedSuffix = voidedCount > 0
      ? `; voided ${voidedCount} bid(s) for movies that released before processing`
      : ''

    return jsonResponse({
      message: nothingProcessed && voidedCount === 0
        ? 'No bids to process'
        : `Processed ${results.length} pickup(s) and ${counterpickResults.length} counterpick(s)${voidedSuffix}`,
      mode,
      processed: results.length,
      results,
      counterpick_processed: counterpickResults.length,
      counterpick_results: counterpickResults,
      voided_pickup_bids: voidedPickupResults.length > 0 ? voidedPickupResults : undefined,
      voided_counterpick_bids: voidedCounterpickResults.length > 0 ? voidedCounterpickResults : undefined,
      errors: errors.length > 0 ? errors : undefined,
      notifications: notificationSummary,
    })
  } catch (error) {
    console.error('Unexpected error in process-bids:', error)
    return errorResponse('Internal server error', 500)
  }
})
