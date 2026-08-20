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
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isUpcomingMovie, internalErrorResponse } from '../_shared/utils.ts'
import { sendEmail } from '../_shared/email.ts'
import { getBidWonEmailHtml, getBidWonEmailText } from '../_shared/email-templates/bid-won.ts'
import { getBidLostEmailHtml, getBidLostEmailText } from '../_shared/email-templates/bid-lost.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor, getLeagueName } from '../_shared/discord.ts'
import {
  type BidContest,
  type BidLossReason,
  resolveBidWinners,
  type TeamCapacity,
  type DroppableCandidate,
  droppableHoldingIds,
  resolveTargetRevalidation,
  type TargetVoidReason,
} from '../_shared/bid-resolution.ts'
import {
  getCounterpickNoSlotsEmailHtml,
  getCounterpickNoSlotsEmailText,
} from '../_shared/email-templates/counterpick-no-slots.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import { logNotificationDelivery, statusFromEmailResult } from '../_shared/notification-log.ts'

const log = createLogger('process-bids')

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

/**
 * A bid group that was due but left unresolved because a counter-bid response
 * window is still open. The extended (hourly) run resolves it once the window
 * closes; until then the league is told its results are delayed, not that no
 * bids were placed.
 */
interface DeferredGroup {
  league_id: string
  movie_title: string
  counter_window_ends: string
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

/**
 * The latest counter-response deadline among `bids` that has not passed yet, or
 * null once every window has closed. While one is open the whole bid group is
 * unsettled -- an outbid team can still counter -- so processing waits for the
 * last window rather than the first.
 *
 * Deadlines are ISO timestamps, so they compare correctly as strings.
 */
function latestOpenResponseDeadline(
  bids: Array<{ response_deadline: string | null }>,
  now: Date,
): string | null {
  let latest: string | null = null

  for (const bid of bids) {
    const deadline = bid.response_deadline
    if (!deadline || new Date(deadline) <= now) continue
    if (!latest || deadline > latest) latest = deadline
  }

  return latest
}

interface DeadlinedBid {
  response_deadline: string | null
  processing_deadline: string
}

/**
 * Bids on `table` whose window has closed.
 * - `weekly`: active bids whose regular processing deadline has passed.
 * - `extended`: bids whose counter-response window has expired, and only those
 *   that really were in counter-bid extra time -- a response_deadline at or
 *   before the processing deadline just means the regular weekly run will pick
 *   them up. A `response_deadline` only ever lives on an 'outbid' row (it is
 *   cleared whenever a bid goes back to 'active'), so the expired-window signal
 *   is carried by outbid rows; each hit's full bid group is re-read during
 *   processing, which finds the active leader to award.
 */
async function fetchDueBids<T extends DeadlinedBid>(
  serviceClient: ServiceClient,
  table: 'pickup_bids' | 'counterpick_bids',
  mode: 'weekly' | 'extended',
  now: Date,
  leagueId?: string,
): Promise<{ bids: T[]; error: unknown }> {
  let query = serviceClient.from(table).select('*')

  if (mode === 'weekly') {
    query = query.eq('status', 'active').lte('processing_deadline', now.toISOString())
  } else {
    query = query
      .in('status', ['active', 'outbid'])
      .not('response_deadline', 'is', null)
      .lt('response_deadline', now.toISOString())
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
    log.error('Failed to fetch budget', { team_id: teamId, error: serializeError(budgetFetchError) })
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
    log.error('Failed to update budget', { team_id: teamId, error: serializeError(budgetUpdateError) })
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
      log.error(failureMessage, { error: serializeError(error) })
      for (const id of batch) unreadIds.add(id)
      continue
    }
    rows.push(...(data ?? []))
  }

  return { rows, unreadIds }
}

/**
 * How much each team in `contests` can still absorb this run.
 *
 * `freeSlots` means "room for one more movie of this kind", and the two kinds
 * measure against different pools:
 * - `counterpick`: remaining `leagues.bidding_counterpick_slots`, counted from
 *   the `counterpicks` rows a team already holds -- the same accounting
 *   place-counterpick-bid applies, so the two cannot disagree about what "used
 *   a slot" means.
 * - `pickup`: pooled roster room, `leagues.total_slots` minus every active
 *   holding. Draft picks and pickups share the pool, which is what lets a team
 *   drop a badly drafted movie to make room for a pickup.
 *
 * They never collide because the two kinds are resolved in separate calls with
 * their own capacity map.
 *
 * Fails closed on every dimension: a team whose league config, holdings,
 * budget, or drop count could not be read is given zero capacity. That
 * withholds awards for one run, which a later run can still make -- whereas
 * reading a failed count as "zero used" would hand a team a full allowance on
 * top of what it already holds, the very over-cap outcome this exists to
 * prevent.
 *
 * `slotsByLeague` carries the league's *total* allowance for this kind (not the
 * remainder); the "no slots" notification copy quotes it.
 */
async function getTeamCapacities(
  serviceClient: ServiceClient,
  contests: BidContest[],
  kind: 'pickup' | 'counterpick',
): Promise<{ capacities: Map<string, TeamCapacity>; slotsByLeague: Map<string, number> }> {
  const leagueOfTeam = new Map<string, string>()
  for (const contest of contests) {
    const leagueId = contest.key.split(':')[0]
    for (const bid of contest.activeBids) leagueOfTeam.set(bid.team_id, leagueId)
  }

  const leagueIds = [...new Set(leagueOfTeam.values())]
  const teamIds = [...leagueOfTeam.keys()]
  const capacities = new Map<string, TeamCapacity>()
  const slotsByLeague = new Map<string, number>()
  if (teamIds.length === 0) return { capacities, slotsByLeague }

  const { rows: leagueRows } = await selectByIdBatches<{
    id: string
    total_slots: number | null
    bidding_counterpick_slots: number | null
    drop_limit: number | null
    counterpicks_block_drops: boolean | null
  }>(
    leagueIds,
    'Failed to load league capacity config:',
    (batch) =>
      serviceClient
        .from('leagues')
        .select('id, total_slots, bidding_counterpick_slots, drop_limit, counterpicks_block_drops')
        .in('id', batch),
  )

  // A league missing from the result -- unread or genuinely absent -- yields 0
  // slots below, so no separate handling is needed for its failure case.
  const leagueById = new Map(leagueRows.map((league) => [league.id, league]))
  for (const league of leagueRows) {
    slotsByLeague.set(
      league.id,
      kind === 'counterpick' ? (league.bidding_counterpick_slots ?? 0) : (league.total_slots ?? 0),
    )
  }

  const { rows: budgetRows, unreadIds: unreadBudgetTeams } = await selectByIdBatches<
    { team_id: string; remaining_budget: number }
  >(
    teamIds,
    'Failed to load team budgets:',
    (batch) =>
      serviceClient.from('team_budgets').select('team_id, remaining_budget').in('team_id', batch),
  )
  const budgetByTeam = new Map(budgetRows.map((row) => [row.team_id, row.remaining_budget]))

  const usedByTeam = new Map<string, number>()
  let unreadUsedTeams = new Set<string>()

  if (kind === 'counterpick') {
    const { rows, unreadIds } = await selectByIdBatches<{ counterpicker_team_id: string }>(
      teamIds,
      'Failed to count used counterpick slots:',
      (batch) =>
        serviceClient
          .from('counterpicks')
          .select('counterpicker_team_id')
          .eq('phase', 'bidding')
          .in('counterpicker_team_id', batch),
    )
    for (const row of rows) {
      usedByTeam.set(row.counterpicker_team_id, (usedByTeam.get(row.counterpicker_team_id) ?? 0) + 1)
    }
    unreadUsedTeams = unreadIds
  } else {
    // team_holdings excludes dropped rows itself, so there is no dropped_at
    // filter to forget here.
    const { rows, unreadIds } = await selectByIdBatches<{ team_id: string }>(
      teamIds,
      'Failed to count active holdings:',
      (batch) => serviceClient.from('team_holdings').select('team_id').in('team_id', batch),
    )
    for (const row of rows) {
      usedByTeam.set(row.team_id, (usedByTeam.get(row.team_id) ?? 0) + 1)
    }
    unreadUsedTeams = unreadIds
  }

  // Drops and droppable holdings are pickup-only; counterpicks carry no
  // conditional drops, which makes canAfford collapse to today's behaviour.
  const dropsByTeam = new Map<string, number>()
  const droppableByTeam = new Map<string, Set<string>>()
  let unreadDropTeams = new Set<string>()

  if (kind === 'pickup') {
    const { rows: dropRows, unreadIds } = await selectByIdBatches<{ team_id: string }>(
      teamIds,
      'Failed to count team drops:',
      (batch) => serviceClient.from('team_drops').select('team_id').in('team_id', batch),
    )
    for (const row of dropRows) {
      dropsByTeam.set(row.team_id, (dropsByTeam.get(row.team_id) ?? 0) + 1)
    }
    unreadDropTeams = unreadIds

    const { rows: holdingRows } = await selectByIdBatches<{
      holding_id: string
      team_id: string
      movie_id: string
      release_date: string | null
      counterpicked_by_team_id: string | null
    }>(
      teamIds,
      'Failed to load droppable holdings:',
      (batch) =>
        serviceClient
          .from('team_holdings')
          .select('holding_id, team_id, movie_id, release_date, counterpicked_by_team_id')
          .in('team_id', batch),
    )

    // One query for every pending counterpick auction touching these movies,
    // rather than one per holding.
    const movieIds = [...new Set(holdingRows.map((row) => row.movie_id))]
    const { rows: pendingCpBids } = await selectByIdBatches<{ movie_id: string }>(
      movieIds,
      'Failed to load pending counterpick bids:',
      (batch) =>
        serviceClient
          .from('counterpick_bids')
          .select('movie_id')
          .in('status', ['active', 'outbid'])
          .in('movie_id', batch),
    )
    const contestedMovieIds = new Set(pendingCpBids.map((row) => row.movie_id))

    const today = new Date().toISOString().slice(0, 10)
    const candidatesByTeam = new Map<string, DroppableCandidate[]>()
    for (const row of holdingRows) {
      const bucket = candidatesByTeam.get(row.team_id) ?? []
      bucket.push({
        holdingId: row.holding_id,
        releaseDate: row.release_date,
        counterpickedByTeamId: row.counterpicked_by_team_id,
        hasPendingCounterpickBid: contestedMovieIds.has(row.movie_id),
      })
      candidatesByTeam.set(row.team_id, bucket)
    }

    for (const [teamId, candidates] of candidatesByTeam) {
      const league = leagueById.get(leagueOfTeam.get(teamId) ?? '')
      droppableByTeam.set(
        teamId,
        droppableHoldingIds(candidates, {
          today,
          // Unknown league config blocks drops: the conservative reading.
          counterpicksBlockDrops: league?.counterpicks_block_drops ?? true,
        }),
      )
    }
  }

  for (const [teamId, leagueId] of leagueOfTeam) {
    const league = leagueById.get(leagueId)
    const unreadable =
      unreadUsedTeams.has(teamId) || unreadBudgetTeams.has(teamId) || unreadDropTeams.has(teamId)

    if (unreadable || !league) {
      capacities.set(teamId, {
        freeSlots: 0,
        remainingBudget: 0,
        remainingDrops: 0,
        droppableHoldingIds: new Set(),
      })
      continue
    }

    capacities.set(teamId, {
      freeSlots: Math.max(0, (slotsByLeague.get(leagueId) ?? 0) - (usedByTeam.get(teamId) ?? 0)),
      remainingBudget: budgetByTeam.get(teamId) ?? 0,
      remainingDrops: Math.max(0, (league.drop_limit ?? 0) - (dropsByTeam.get(teamId) ?? 0)),
      droppableHoldingIds: droppableByTeam.get(teamId) ?? new Set(),
    })
  }

  return { capacities, slotsByLeague }
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

/** Every reason a pending bid can be voided at processing time instead of settled. */
type VoidReasonCode = 'movie_released' | TargetVoidReason

/**
 * Title/body copy for a voided-bid notification, one entry per `VoidReasonCode`.
 * All four share the same shape (a movie became un-winnable while the bid sat
 * pending) but need distinct wording, and each must say plainly that the
 * budget was not charged.
 */
function voidedBidCopy(
  reasonCode: VoidReasonCode,
  movieTitle: string,
  amount: number,
): { title: string; body: string } {
  const title = `Bid cancelled for ${movieTitle}`
  switch (reasonCode) {
    case 'movie_released':
      return {
        title,
        body: `${movieTitle} was released before your bid of $${amount} could be processed. Your bid was cancelled and your budget was not charged.`,
      }
    case 'movie_dropped':
      return {
        title,
        body: `${movieTitle} was dropped before your counterpick bid of $${amount} could be processed. Your bid was cancelled and your budget was not charged.`,
      }
    case 'target_owned':
      return {
        title,
        body: `You now own ${movieTitle}, so your counterpick bid of $${amount} was cancelled. Your budget was not charged.`,
      }
    case 'target_missing':
      return {
        title,
        body: `${movieTitle} is no longer available to counterpick, so your bid of $${amount} was cancelled. Your budget was not charged.`,
      }
  }
}

/**
 * Notify a team's owner that their bid was voided at processing time -- the
 * movie released, was dropped by its holder, was traded to the bidder's own
 * team, or its target holding disappeared entirely. Reuses the 'bid_lost'
 * notification type since no dedicated type exists for any of these;
 * `data.reason` carries the reason code so the frontend can special-case copy
 * later.
 *
 * `detail` is only meaningful for `movie_released`, whose underlying
 * `isUpcomingMovie()` check can fail for several distinct reasons (no release
 * date, released this year, released a prior year) -- it is stored verbatim as
 * `data.release_check_reason` for that case and otherwise omitted, so this
 * generalization does not change what a `movie_released` notification's
 * `data` payload looks like.
 */
async function notifyVoidedBidder(
  serviceClient: ServiceClient,
  bid: { id: string; league_id: string; team_id: string; amount: number },
  movieTitle: string,
  reasonCode: VoidReasonCode,
  extraData: Record<string, unknown>,
  detail = '',
): Promise<void> {
  const bidderUserId = await getTeamUserId(serviceClient, bid.team_id)
  if (!bidderUserId) return

  const { title, body } = voidedBidCopy(reasonCode, movieTitle, bid.amount)

  const data: Record<string, unknown> = {
    bid_id: bid.id,
    amount: bid.amount,
    reason: reasonCode,
  }
  if (reasonCode === 'movie_released') {
    data.release_check_reason = detail
  }
  Object.assign(data, extraData)

  await serviceClient.from('notifications').insert({
    user_id: bidderUserId,
    league_id: bid.league_id,
    type: 'bid_lost',
    title,
    body,
    data,
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
  }).then((result) => {
    logNotificationDelivery(serviceClient, {
      notificationType: 'counterpick_won',
      recipientEmail: email,
      recipientUserId: userId,
      status: statusFromEmailResult(result),
      messageId: result.messageId,
      errorMessage: result.error,
      metadata: { league_id: winner.league_id, movie_id: movieId, movie_title: movieTitle, amount: winner.amount },
    })
  }).catch((err) => {
    log.error('Failed to send counterpick bid won email', { error: serializeError(err) })
    logNotificationDelivery(serviceClient, {
      notificationType: 'counterpick_won',
      recipientEmail: email,
      recipientUserId: userId,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { league_id: winner.league_id, movie_id: movieId, movie_title: movieTitle, amount: winner.amount },
    })
  })
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
    reason: BidLossReason
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
    }).then((result) => {
      logNotificationDelivery(serviceClient, {
        notificationType: 'counterpick_no_slots',
        recipientEmail: email,
        recipientUserId: userId,
        status: statusFromEmailResult(result),
        messageId: result.messageId,
        errorMessage: result.error,
        metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, amount: loserBid.amount, slots },
      })
    }).catch((err) => {
      log.error('Failed to send counterpick no-slots email', { error: serializeError(err) })
      logNotificationDelivery(serviceClient, {
        notificationType: 'counterpick_no_slots',
        recipientEmail: email,
        recipientUserId: userId,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, amount: loserBid.amount, slots },
      })
    })
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
  }).then((result) => {
    logNotificationDelivery(serviceClient, {
      notificationType: 'counterpick_lost',
      recipientEmail: email,
      recipientUserId: userId,
      status: statusFromEmailResult(result),
      messageId: result.messageId,
      errorMessage: result.error,
      metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, amount: loserBid.amount, winning_amount: winner.amount },
    })
  }).catch((err) => {
    log.error('Failed to send counterpick bid lost email', { error: serializeError(err) })
    logNotificationDelivery(serviceClient, {
      notificationType: 'counterpick_lost',
      recipientEmail: email,
      recipientUserId: userId,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, amount: loserBid.amount, winning_amount: winner.amount },
    })
  })
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
  deferred: DeferredGroup[],
): Promise<{ contests: BidContest[]; bidsByContest: Map<string, CounterpickBid[]> }> {
  const contests: BidContest[] = []
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
      const openWindowEnds = latestOpenResponseDeadline(bids, now)
      if (openWindowEnds) {
        const { data: movie } = await serviceClient
          .from('movies')
          .select('title')
          .eq('id', movieId)
          .single()
        deferred.push({
          league_id: leagueId,
          movie_title: movie?.title || `Movie ${movieId}`,
          counter_window_ends: openWindowEnds,
        })
        continue
      }

      const activeBids = bids.filter((bid) => bid.status === 'active')
      if (activeBids.length === 0) continue

      contests.push({ key, activeBids })
      bidsByContest.set(key, bids)
    } catch (error) {
      log.error('Error loading counterpick bids', { movie_key: key, error: serializeError(error) })
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
  contests: BidContest[],
  bidsByContest: Map<string, CounterpickBid[]>,
  voided: VoidedBidResult[],
): Promise<BidContest[]> {
  const movieIds = [...new Set(contests.map(({ key }) => key.split(':')[1]))]

  const { rows: movies } = await selectByIdBatches<
    { id: string; title: string; release_date: string | null }
  >(
    movieIds,
    'Failed to read movies for the counterpick release check:',
    (batch) => serviceClient.from('movies').select('id, title, release_date').in('id', batch),
  )
  const moviesById = new Map(movies.map((movie) => [movie.id, movie]))

  const surviving: BidContest[] = []

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
      await notifyVoidedBidder(serviceClient, bid, movieTitle, 'movie_released', {
        movie_id: movieId,
        bid_type: 'counterpick',
      }, reason)

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

    log.info('Voided counterpick bid(s): movie released before processing', {
      voided_count: bidsToVoid.length,
      movie_title: movieTitle,
    })
  }

  return surviving
}

/** Human-readable `VoidedBidResult.reason` text per target-revalidation void reason. */
const TARGET_VOID_REASON_TEXT: Record<TargetVoidReason, string> = {
  movie_dropped: 'Movie was dropped by its holder before the bid could be processed',
  target_owned: 'The target movie was traded to the bidder\'s own team',
  target_missing: 'The target holding no longer exists',
}

/**
 * Re-validate every active counterpick bid against the row it targets (a
 * draft_picks or pickups holding), voiding any bid whose target has gone stale
 * since it was placed -- dropped, traded to the bidder's own team, or gone
 * missing entirely -- and retargeting the rest at the row's *current* holder
 * rather than the bid's possibly-stale stored `target_team_id`.
 *
 * A contest's bids do not all necessarily share one target row: a movie
 * dropped and re-picked-up mid-week leaves one bid pointing at the now-dead
 * draft_pick row and another at the live pickup row, and only the former
 * should die here.
 *
 * Runs before slot resolution for the same reason `voidReleasedCounterpickContests`
 * does: a bid that can never be awarded must not consume one of the bidder's
 * scarce counterpick slots.
 *
 * If every active bid on a contest is voided, the contest is dropped entirely
 * and any remaining 'outbid' bids on it are cancelled too, so they don't
 * strand as 'outbid' forever -- the same sweep `voidReleasedCounterpickContests`
 * does via `bidsByContest` when a whole movie goes dead.
 */
async function revalidateCounterpickTargets(
  serviceClient: ServiceClient,
  contests: BidContest[],
  bidsByContest: Map<string, CounterpickBid[]>,
  voided: VoidedBidResult[],
): Promise<BidContest[]> {
  const allActiveBids = contests.flatMap((contest) => contest.activeBids as CounterpickBid[])

  const draftPickIds = [...new Set(
    allActiveBids.filter((bid) => bid.draft_pick_id).map((bid) => bid.draft_pick_id as string),
  )]
  const pickupIds = [...new Set(
    allActiveBids.filter((bid) => bid.pickup_id).map((bid) => bid.pickup_id as string),
  )]

  type TargetRow = { id: string; team_id: string; dropped_at: string | null }

  const movieIds = [...new Set(contests.map((contest) => contest.key.split(':')[1]))]

  const [
    { rows: draftRows, unreadIds: unreadDraftPickIds },
    { rows: pickupRows, unreadIds: unreadPickupIds },
    { rows: movies },
  ] = await Promise.all([
    selectByIdBatches<TargetRow>(
      draftPickIds,
      'Failed to read draft_picks for the counterpick target check:',
      (batch) => serviceClient.from('draft_picks').select('id, team_id, dropped_at').in('id', batch),
    ),
    selectByIdBatches<TargetRow>(
      pickupIds,
      'Failed to read pickups for the counterpick target check:',
      (batch) => serviceClient.from('pickups').select('id, team_id, dropped_at').in('id', batch),
    ),
    selectByIdBatches<{ id: string; title: string }>(
      movieIds,
      'Failed to read movies for the counterpick target check:',
      (batch) => serviceClient.from('movies').select('id, title').in('id', batch),
    ),
  ])

  const targetRowById = new Map([...draftRows, ...pickupRows].map((row) => [row.id, row]))
  const unreadTargetIds = new Set([...unreadDraftPickIds, ...unreadPickupIds])
  const titleByMovieId = new Map(movies.map((movie) => [movie.id, movie.title]))

  const surviving: BidContest[] = []

  /**
   * Split bids by whether their target holding still supports them,
   * retargeting each keeper in place: the stored target_team_id can be stale
   * after a trade even for a bid that is otherwise still perfectly valid, so
   * the winner a kept bid eventually becomes must carry the row's current
   * holder.
   */
  function partitionByTargetValidity(bids: CounterpickBid[]): {
    kept: CounterpickBid[]
    toVoid: { bid: CounterpickBid; reason: TargetVoidReason }[]
  } {
    const kept: CounterpickBid[] = []
    const toVoid: { bid: CounterpickBid; reason: TargetVoidReason }[] = []

    for (const bid of bids) {
      const sourceId = (bid.draft_pick_id ?? bid.pickup_id) as string
      const revalidation = resolveTargetRevalidation(
        bid,
        targetRowById.get(sourceId),
        unreadTargetIds.has(sourceId),
      )

      if (revalidation.outcome === 'void') {
        toVoid.push({ bid, reason: revalidation.reason })
        continue
      }

      bid.target_team_id = revalidation.targetTeamId
      kept.push(bid)
    }

    return { kept, toVoid }
  }

  /**
   * Cancel the given bids on one movie, notify each bidder, record them in the
   * run summary, and drop them from the shared per-contest bid list -- without
   * that last step the awarding loop below would later try to mark an
   * already-cancelled bid as 'lost' and send it a contradictory loser
   * notification.
   */
  async function voidBids(
    contestKey: string,
    entries: { bid: CounterpickBid; reason: TargetVoidReason }[],
    movieId: string,
    movieTitle: string,
  ): Promise<void> {
    await serviceClient
      .from('counterpick_bids')
      .update({ status: 'cancelled' })
      .in('id', entries.map(({ bid }) => bid.id))

    for (const { bid, reason } of entries) {
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
        reason: TARGET_VOID_REASON_TEXT[reason],
        movie_id: movieId,
      })
    }

    const voidedIds = new Set(entries.map(({ bid }) => bid.id))
    bidsByContest.set(
      contestKey,
      (bidsByContest.get(contestKey) ?? []).filter((bid) => !voidedIds.has(bid.id)),
    )
  }

  for (const contest of contests) {
    const movieId = contest.key.split(':')[1]
    const movieTitle = titleByMovieId.get(movieId) || `Movie ${movieId}`

    const { kept: keptBids, toVoid } = partitionByTargetValidity(
      contest.activeBids as CounterpickBid[],
    )

    if (toVoid.length > 0) {
      await voidBids(contest.key, toVoid, movieId, movieTitle)
      log.info('Voided counterpick bid(s): target holding no longer valid', {
        voided_count: toVoid.length,
        movie_title: movieTitle,
        contest_dropped: keptBids.length === 0,
      })
    }

    if (keptBids.length > 0) {
      surviving.push({ key: contest.key, activeBids: keptBids })
      continue
    }

    // No active bid survived. Give each remaining 'outbid' bid the same
    // treatment cancel-counterpick-bid gives when a leader withdraws:
    // revalidate it against its own target and promote it back to 'active' so
    // it re-enters the contest -- its target can differ from the dead
    // leader's (e.g. the movie was dropped and re-picked-up mid-week). Bids
    // whose own target is also gone are voided instead, so nothing strands as
    // 'outbid' forever with no active bid left to ever beat. A bid kept on a
    // failed read is promoted too: 'active' bids are re-fetched and
    // revalidated on every later run, so promotion is the self-healing
    // fail-open, whereas leaving it 'outbid' in a contest with no active bids
    // would strand it (fetchDueBids only looks at 'active' rows).
    const outbidBids = (bidsByContest.get(contest.key) ?? []).filter(
      (bid) => bid.status === 'outbid',
    )
    const { kept: promotable, toVoid: outbidToVoid } = partitionByTargetValidity(outbidBids)

    if (outbidToVoid.length > 0) {
      await voidBids(contest.key, outbidToVoid, movieId, movieTitle)
    }

    if (promotable.length === 0) continue

    await serviceClient
      .from('counterpick_bids')
      .update({ status: 'active', countered_at: null, response_deadline: null })
      .in('id', promotable.map((bid) => bid.id))

    for (const bid of promotable) bid.status = 'active'

    log.info('Promoted outbid counterpick bid(s): contest leaders voided', {
      promoted_count: promotable.length,
      movie_title: movieTitle,
    })

    surviving.push({ key: contest.key, activeBids: promotable })
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
  deferred: DeferredGroup[],
): Promise<CounterpickProcessResult[]> {
  const results: CounterpickProcessResult[] = []
  if (dueBids.length === 0) return results

  const { contests: settledContests, bidsByContest } = await loadSettledCounterpickContests(
    serviceClient,
    dueBids,
    now,
    errors,
    deferred
  )
  if (settledContests.length === 0) return results

  const unreleasedContests = await voidReleasedCounterpickContests(
    serviceClient,
    settledContests,
    bidsByContest,
    voided
  )
  if (unreleasedContests.length === 0) return results

  // Must run before slot resolution, same as the release check above: a bid
  // whose target has gone stale (dropped, traded away, traded to itself) can
  // never be awarded, so it must not occupy one of the bidder's scarce slots.
  const contests = await revalidateCounterpickTargets(
    serviceClient,
    unreleasedContests,
    bidsByContest,
    voided
  )
  if (contests.length === 0) return results

  const { capacities, slotsByLeague } = await getTeamCapacities(
    serviceClient,
    contests,
    'counterpick',
  )
  const { winners, lossReasons } = resolveBidWinners(contests, capacities)

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
        log.error('Movie not found for counterpick bid', { movie_id: movieId })
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
          log.error('Failed to create counterpick', { movie_title: movieTitle, error: serializeError(counterpickError) })
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

        log.info('Processed counterpick bid', {
          movie_title: movieTitle,
          winner_team_id: winner.team_id,
          amount: winner.amount,
        })
      } else {
        log.info('No counterpick awarded: every bidder had filled its slots', { movie_title: movieTitle })
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
      log.error('Error processing counterpick bids', { movie_key: key, error: serializeError(error) })
      errors.push({
        movie_key: key,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}

/** One entry per league, in the order the items were collected. */
function groupByLeague<T extends { league_id: string }>(items: T[]): Map<string, T[]> {
  const byLeague = new Map<string, T[]>()

  for (const item of items) {
    const existing = byLeague.get(item.league_id)
    if (existing) {
      existing.push(item)
    } else {
      byLeague.set(item.league_id, [item])
    }
  }

  return byLeague
}

async function sendBidResultsDiscordNotifications(
  serviceClient: ServiceClient,
  results: BidResultSummary[],
  embedTitle: string,
  itemLabel: string,
  fieldPrefix: string,
): Promise<void> {
  if (results.length === 0) return

  const resultsByLeague = groupByLeague(results)

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

/**
 * Tell each affected league why its weekly results did not land: one or more
 * bid groups are in counter-bid extra time. Sent from the weekly run only --
 * the hourly extended run would repeat it every hour while a window stays open.
 */
async function sendBidsDeferredDiscordNotifications(
  serviceClient: ServiceClient,
  deferred: DeferredGroup[],
): Promise<void> {
  if (deferred.length === 0) return

  const discordPromises = [...groupByLeague(deferred)].map(async ([leagueId, groups]) => {
    const leagueName = await getLeagueName(serviceClient, leagueId)

    const fields = groups.slice(0, 10).map((group) => ({
      name: group.movie_title,
      // Discord renders <t:seconds:R> as a live "in 2 hours" countdown.
      value: `Counter window closes <t:${Math.floor(new Date(group.counter_window_ends).getTime() / 1000)}:R>`,
      inline: true,
    }))

    return sendDiscordNotification(serviceClient, {
      leagueId,
      category: 'bids',
      embeds: [{
        author: buildEmbedAuthor(leagueName, leagueId),
        title: 'Bidding Results Delayed',
        description: `${groups.length} bid battle${groups.length === 1 ? ' is' : 's are'} still in a counter-bid window. Results will be announced automatically once it closes.`,
        fields,
        color: DISCORD_COLORS.gold,
        footer: { text: leagueName },
        url: buildLeagueUrl(leagueId, '/bidding'),
      }],
    })
  })

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
      log.error('Error fetching discord channels', { error: serializeError(channelsError) })
      return summary
    }

    if (!allChannels || allChannels.length === 0) {
      log.info('No enabled discord channels found for notify_bids')
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
    log.error('Failed to send "no bids" notifications', { error: serializeError(err) })
  }

  return summary
}


Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

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

    run = startJobRun('process-bids')

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    runClient = serviceClient

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
      log.error('Failed to fetch bids', { mode, error: serializeError(bidsError) })
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
    const deferred: DeferredGroup[] = []

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

        const movieBids: PickupBid[] = allBidsForMovie || []

        const openWindowEnds = latestOpenResponseDeadline(movieBids, now)
        if (openWindowEnds) {
          // Someone still has time to counter: leave the group for the extended
          // run, but record the deferral so it can be surfaced downstream.
          const titledBid = movieBids.find((bid) => bid.movie_data?.title)
          deferred.push({
            league_id: leagueId,
            movie_title: titledBid?.movie_data?.title || `Movie #${tmdbId}`,
            counter_window_ends: openWindowEnds,
          })
          continue
        }

        // Find active bids only (outbid entries don't win)
        const activeBids = movieBids.filter((b) => b.status === 'active')
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
            log.error('Failed to create movie', { movie_title: movieTitle, error: serializeError(movieError) })
            errors.push({ movie_key: key, error: 'Failed to create movie record' })
            continue
          }
          movieId = newMovie.id
          movieReleaseDate = newMovie.release_date
        } else {
          log.error('No movie data for bid', { bid_id: winner.id })
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
            await notifyVoidedBidder(serviceClient, bid, movieTitle, 'movie_released', {
              tmdb_id: bid.tmdb_id,
              movie_id: movieId,
            }, reason)

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

          log.info('Voided pickup bid(s): movie released before processing', {
            voided_count: bidIdsToVoid.length,
            movie_title: movieTitle,
          })
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
          log.error('Failed to create pickup', { movie_title: movieTitle, error: serializeError(pickupError) })
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
            }).then((result) => {
              logNotificationDelivery(serviceClient, {
                notificationType: 'bid_won',
                recipientEmail: email,
                recipientUserId: winnerUserId,
                status: statusFromEmailResult(result),
                messageId: result.messageId,
                errorMessage: result.error,
                metadata: { league_id: winner.league_id, movie_id: movieId, movie_title: movieTitle, tmdb_id: winner.tmdb_id, amount: winner.amount },
              })
            }).catch(err => {
              log.error('Failed to send bid won email', { error: serializeError(err) })
              logNotificationDelivery(serviceClient, {
                notificationType: 'bid_won',
                recipientEmail: email,
                recipientUserId: winnerUserId,
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err),
                metadata: { league_id: winner.league_id, movie_id: movieId, movie_title: movieTitle, tmdb_id: winner.tmdb_id, amount: winner.amount },
              })
            })
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
              }).then((result) => {
                logNotificationDelivery(serviceClient, {
                  notificationType: 'bid_lost',
                  recipientEmail: email,
                  recipientUserId: loserUserId,
                  status: statusFromEmailResult(result),
                  messageId: result.messageId,
                  errorMessage: result.error,
                  metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, tmdb_id: loserBid.tmdb_id, amount: loserBid.amount, winning_amount: winner.amount },
                })
              }).catch(err => {
                log.error('Failed to send bid lost email', { error: serializeError(err) })
                logNotificationDelivery(serviceClient, {
                  notificationType: 'bid_lost',
                  recipientEmail: email,
                  recipientUserId: loserUserId,
                  status: 'failed',
                  errorMessage: err instanceof Error ? err.message : String(err),
                  metadata: { league_id: loserBid.league_id, movie_id: movieId, movie_title: movieTitle, tmdb_id: loserBid.tmdb_id, amount: loserBid.amount, winning_amount: winner.amount },
                })
              })
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

        log.info('Processed bid', { movie_title: movieTitle, winner_team_id: winner.team_id, amount: winner.amount })
      } catch (error) {
        log.error('Error processing bids', { movie_key: key, error: serializeError(error) })
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
      log.error('Failed to fetch counterpick bids', { mode, error: serializeError(counterpickBidsError) })
    }

    const voidedCounterpickResults: VoidedBidResult[] = []

    const counterpickResults = await processCounterpickBids(
      serviceClient,
      counterpickBidsToProcess,
      now,
      errors,
      voidedCounterpickResults,
      deferred
    )

    await sendBidResultsDiscordNotifications(serviceClient, results, 'Bidding Results', 'movie', 'Won by')
    await sendBidResultsDiscordNotifications(serviceClient, counterpickResults, 'Counterpick Bidding Results', 'counterpick', 'Counterpicked by')

    // Weekly wrap-up messages. "No bids were placed" is reserved for leagues
    // that truly saw no bid activity: a league whose groups were deferred,
    // voided, or errored had bids, and telling it otherwise misreports the week
    // (deferred leagues get the "results delayed" message above instead).
    let notificationSummary: NotificationSummary | undefined
    if (mode === 'weekly') {
      await sendBidsDeferredDiscordNotifications(serviceClient, deferred)

      const leaguesWithBidActivity = new Set([
        ...results.map(r => r.league_id),
        ...counterpickResults.map(cr => cr.league_id),
        ...deferred.map(d => d.league_id),
        ...voidedPickupResults.map(v => v.league_id),
        ...voidedCounterpickResults.map(v => v.league_id),
        ...errors.map(e => e.movie_key.split(':')[0]),
      ])
      notificationSummary = await sendNoBidsDiscordNotifications(serviceClient, leaguesWithBidActivity, league_id)
    }

    // A run that awarded nothing but voided or deferred something did do work,
    // so it must not report "No bids to process" -- that message is reserved
    // for a truly idle run.
    const voidedCount = voidedPickupResults.length + voidedCounterpickResults.length
    const nothingProcessed = results.length === 0 && counterpickResults.length === 0
    const voidedSuffix = voidedCount > 0
      ? `; voided ${voidedCount} bid(s) for movies that released before processing`
      : ''
    const deferredSuffix = deferred.length > 0
      ? `; deferred ${deferred.length} movie(s) with open counter-bid windows`
      : ''

    // Items attempted = awarded pickups + awarded counterpicks + voided bids +
    // movies whose processing errored. Skipped movies (open counter windows,
    // no active bids) did not have work attempted on them.
    const job_status = await run.finish(serviceClient, {
      processed:
        results.length + counterpickResults.length + voidedCount + errors.length,
      failed: errors.length,
      errors,
      metadata: {
        mode,
        pickups_awarded: results.length,
        counterpicks_awarded: counterpickResults.length,
        bids_voided: voidedCount,
        movies_deferred: deferred.length,
        ...(notificationSummary ? { notifications: notificationSummary } : {}),
      },
    })

    return jsonResponse({
      message: nothingProcessed && voidedCount === 0 && deferred.length === 0
        ? 'No bids to process'
        : `Processed ${results.length} pickup(s) and ${counterpickResults.length} counterpick(s)${voidedSuffix}${deferredSuffix}`,
      mode,
      processed: results.length,
      results,
      counterpick_processed: counterpickResults.length,
      counterpick_results: counterpickResults,
      voided_pickup_bids: voidedPickupResults.length > 0 ? voidedPickupResults : undefined,
      voided_counterpick_bids: voidedCounterpickResults.length > 0 ? voidedCounterpickResults : undefined,
      deferred: deferred.length > 0 ? deferred : undefined,
      errors: errors.length > 0 ? errors : undefined,
      notifications: notificationSummary,
      job_status,
    })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
