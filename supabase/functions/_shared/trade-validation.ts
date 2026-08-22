import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidUUID, errorResponse, createServiceClient } from './utils.ts'
import { sendTradeEmail, formatTradeItemsForEmail, TradeEmailData, TradeEmailType } from './email.ts'
import { logNotificationDelivery, statusFromEmailResult } from './notification-log.ts'

// ============================================================================
// Types
// ============================================================================

/**
 * What a trade item refers to. 'draft_pick'/'pickup' name a roster holding by
 * its base-table id; 'counterpick' names a row in `counterpicks` -- the bet a
 * team owns against somebody else's movie, which is tradeable in its own right.
 */
export type TradeItemSource = 'draft_pick' | 'pickup' | 'counterpick'

/** Does this item occupy a movie slot on a roster? Counterpicks do not. */
export function isRosterItem(item: TradeMovieItem): boolean {
  return item.source !== 'counterpick'
}

export interface TradeMovieItem {
  movie_id: string
  source: TradeItemSource
  source_id: string
  title?: string
  poster_url?: string | null
  release_date?: string | null
}

/**
 * How an item reads in an email or a Discord embed. A counterpick and the movie
 * it targets are the same title, so an unlabelled list of a trade's contents
 * would be genuinely ambiguous about which one is changing hands.
 */
export function tradeItemLabel(item: TradeMovieItem): string {
  const title = item.title ?? 'Unknown Movie'
  return item.source === 'counterpick' ? `Counterpick: ${title}` : title
}

/** A movie title as it appears inside a sentence. */
export function quoteTitle(title: string | null | undefined): string {
  return `"${title ?? 'Unknown Movie'}"`
}

/**
 * How an item reads mid-sentence in an error. `tradeItemLabel`'s prefix form
 * ("Counterpick: Dune") does not survive being dropped into prose, so errors
 * name the bet as what it is: the counterpick ON a movie.
 */
export function tradeItemPhrase(source: TradeItemSource, title: string | null | undefined): string {
  return source === 'counterpick'
    ? `the counterpick on ${quoteTitle(title)}`
    : quoteTitle(title)
}

export interface TradeItems {
  movies: TradeMovieItem[]
  faab: number
}

export interface ValidationResult {
  valid: boolean
  /**
   * User-facing. These strings are rendered verbatim in the trade modals, so
   * they are written as UI copy: name the movie and the team, never a raw id.
   * The matching SQL validator is worded identically on purpose -- see the
   * trading section of CLAUDE.md before changing either.
   */
  error?: string
  /**
   * The trade items the error is about, by source_id, so the UI can mark the
   * offending rows instead of leaving the user to work out which one is meant.
   * Absent when the problem is the deal as a whole (budget, roster size) rather
   * than a particular item.
   */
  invalidSourceIds?: string[]
  /**
   * The league's trade config, returned on success so callers that need it --
   * offer expiry needs `trade_deadline` -- do not fetch the same row again.
   */
  config?: LeagueTradeConfig & { status: string }
}

export interface LeagueTradeConfig {
  trades_enabled: boolean
  trade_deadline: string | null
  trade_veto_hours: number
  trade_review_enabled: boolean
  total_slots: number
  faab_budget: number
  /** Counterpick capacity, per phase -- the caps a trade must not push a team past. */
  draft_counterpick_slots: number
  bidding_counterpick_slots: number
}

export interface TeamInfo {
  id: string
  name: string
  league_id: string
  user_id: string
  remaining_budget: number
}

export interface TradeOffer {
  id: string
  league_id: string
  initiator_team_id: string
  recipient_team_id: string
  initiator_items: TradeItems
  recipient_items: TradeItems
  status: string
  proposed_at: string
  responded_at: string | null
  accepted_at: string | null
  review_ends_at: string | null
  initiator_message: string | null
  response_message: string | null
  veto_reason: string | null
  /** When an unanswered offer lapses; NULL means it stands forever. */
  expires_at?: string | null
  /** How expires_at was derived -- 'fixed' never moves, 'first_release' follows the movie. */
  expiry_anchor?: 'fixed' | 'first_release' | null
  /** Why an expired offer expired; NULL when it ended for a reason veto_reason explains. */
  expired_reason?: 'offer_window' | 'movie_released' | 'league_deadline' | null
}

export interface TradeNotification {
  user_id: string
  league_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
}

// Re-export for backwards compatibility with existing imports
export { createServiceClient } from './utils.ts'

// ============================================================================
// Trade Offer Operations
// ============================================================================

/**
 * Fetch a trade offer by ID
 */
export async function getTradeOffer(
  supabase: SupabaseClient,
  tradeOfferId: string
): Promise<{ offer: TradeOffer; error: null } | { offer: null; error: Response }> {
  if (!tradeOfferId || !isValidUUID(tradeOfferId)) {
    return { offer: null, error: errorResponse('Valid trade_offer_id is required', 400) }
  }

  const { data, error } = await supabase
    .from('trade_offers')
    .select('*')
    .eq('id', tradeOfferId)
    .single()

  if (error || !data) {
    return { offer: null, error: errorResponse('Trade offer not found', 404) }
  }

  return { offer: data as TradeOffer, error: null }
}

/**
 * Validate trade offer is in an allowed status
 */
export function validateTradeStatus(
  offer: TradeOffer,
  allowedStatuses: string[],
  actionDescription: string
): Response | null {
  if (!allowedStatuses.includes(offer.status)) {
    return errorResponse(
      `Cannot ${actionDescription} a trade with status "${offer.status}"`,
      400
    )
  }
  return null
}

// ============================================================================
// Notification Helpers
// ============================================================================

/**
 * Create and insert trade notifications for one or both teams
 */
export type NotifiableTrade = Pick<
  TradeOffer,
  'id' | 'league_id' | 'initiator_team_id' | 'recipient_team_id'
>

export async function notifyTradeParties(
  supabase: SupabaseClient,
  options: {
    tradeOffer: NotifiableTrade
    notifyInitiator?: {
      type: string
      title: string
      bodyFn: (otherTeamName: string) => string
      data?: Record<string, unknown>
    }
    notifyRecipient?: {
      type: string
      title: string
      bodyFn: (otherTeamName: string) => string
      data?: Record<string, unknown>
    }
  }
): Promise<void> {
  const { tradeOffer, notifyInitiator, notifyRecipient } = options
  const notifications: TradeNotification[] = []

  if (notifyInitiator) {
    const initiatorInfo = await getTeamInfo(supabase, tradeOffer.initiator_team_id)
    const recipientTeamName = await getTeamName(supabase, tradeOffer.recipient_team_id)
    if (initiatorInfo) {
      notifications.push({
        user_id: initiatorInfo.user_id,
        league_id: tradeOffer.league_id,
        type: notifyInitiator.type,
        title: notifyInitiator.title,
        body: notifyInitiator.bodyFn(recipientTeamName),
        data: { trade_offer_id: tradeOffer.id, ...notifyInitiator.data },
      })
    }
  }

  if (notifyRecipient) {
    const recipientInfo = await getTeamInfo(supabase, tradeOffer.recipient_team_id)
    const initiatorTeamName = await getTeamName(supabase, tradeOffer.initiator_team_id)
    if (recipientInfo) {
      notifications.push({
        user_id: recipientInfo.user_id,
        league_id: tradeOffer.league_id,
        type: notifyRecipient.type,
        title: notifyRecipient.title,
        body: notifyRecipient.bodyFn(initiatorTeamName),
        data: { trade_offer_id: tradeOffer.id, ...notifyRecipient.data },
      })
    }
  }

  if (notifications.length > 0) {
    const { error } = await supabase.from('notifications').insert(notifications)
    if (error) {
      console.error('Failed to create trade notifications:', error)
    }
  }
}

/**
 * Get team name by ID
 */
export async function getTeamName(
  supabase: SupabaseClient,
  teamId: string
): Promise<string> {
  const { data } = await supabase
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .single()

  return data?.name ?? 'A team'
}

// ============================================================================
// Discord Mention Helpers
// ============================================================================

/**
 * Builds Discord mention content from a list of possibly-linked discord_ids.
 * Unlinked parties (null/undefined) are silently omitted -- a trade with one
 * or both sides not connected to Discord still gets a clean notification
 * with no mention text, rather than a broken `<@null>`.
 */
export function buildTradeMentions(
  discordIds: Array<string | null | undefined>
): string | undefined {
  const mentions = discordIds.filter((id): id is string => Boolean(id)).map((id) => `<@${id}>`)
  return mentions.length > 0 ? mentions.join(' ') : undefined
}

/**
 * Resolves the given users' linked Discord IDs and builds mention content
 * for a trade notification. profiles has no discord_id column -- the link
 * lives only in auth.identities, which requires the get_discord_ids_by_user_ids
 * SECURITY DEFINER RPC (PostgREST cannot query the auth schema directly).
 *
 * Accepts missing user IDs so callers can pass team lookups straight through
 * without pre-filtering; a team whose row didn't resolve is simply skipped.
 */
export async function getTradeMentionContent(
  supabase: SupabaseClient,
  maybeUserIds: Array<string | null | undefined>
): Promise<string | undefined> {
  const userIds = maybeUserIds.filter((id): id is string => Boolean(id))
  if (userIds.length === 0) return undefined

  const { data, error } = await supabase.rpc('get_discord_ids_by_user_ids', {
    p_user_ids: userIds,
  })

  if (error) {
    console.error('Failed to resolve trade party Discord IDs:', error.message)
    return undefined
  }

  return buildTradeMentions((data ?? []).map((row: { discord_id: string | null }) => row.discord_id))
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that a string is a valid trade items structure
 * @param items - The trade items to validate
 * @param maxBudget - Maximum budget allowed (from league configuration, defaults to 100)
 */
export function validateTradeItemsStructure(items: unknown, maxBudget = 100): ValidationResult {
  if (!items || typeof items !== 'object') {
    return { valid: false, error: 'Invalid items structure' }
  }

  const typedItems = items as TradeItems

  // Validate the budget amount - use league's configured maximum
  if (typeof typedItems.faab !== 'number' || typedItems.faab < 0) {
    return { valid: false, error: 'Budget must be a non-negative number' }
  }

  if (typedItems.faab > maxBudget) {
    return { valid: false, error: `Budget must not exceed the league maximum of $${maxBudget}` }
  }

  if (!Number.isInteger(typedItems.faab)) {
    return { valid: false, error: 'Budget must be a whole number' }
  }

  // Validate movies array
  if (!Array.isArray(typedItems.movies)) {
    return { valid: false, error: 'Movies must be an array' }
  }

  for (const movie of typedItems.movies) {
    if (!movie.movie_id || !isValidUUID(movie.movie_id)) {
      return { valid: false, error: 'Invalid movie_id in trade items' }
    }
    if (!movie.source || !['draft_pick', 'pickup', 'counterpick'].includes(movie.source)) {
      return { valid: false, error: 'Invalid source type (must be draft_pick, pickup or counterpick)' }
    }
    if (!movie.source_id || !isValidUUID(movie.source_id)) {
      return { valid: false, error: 'Invalid source_id in trade items' }
    }
  }

  return { valid: true }
}

/**
 * Validate that trade has at least one item
 */
export function validateTradeNotEmpty(
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): ValidationResult {
  const hasInitiatorItems = initiatorItems.faab > 0 || initiatorItems.movies.length > 0
  const hasRecipientItems = recipientItems.faab > 0 || recipientItems.movies.length > 0

  if (!hasInitiatorItems && !hasRecipientItems) {
    return { valid: false, error: 'Trade must include at least one item' }
  }

  return { valid: true }
}

/**
 * Validate league allows trading and is before deadline
 */
export function validateLeagueTradingEnabled(
  config: LeagueTradeConfig,
  leagueStatus: string
): ValidationResult {
  if (!config.trades_enabled) {
    return { valid: false, error: 'Trading is not enabled for this league' }
  }

  if (leagueStatus !== 'active') {
    return { valid: false, error: 'League must be active to trade' }
  }

  // Check trade deadline
  if (config.trade_deadline) {
    const deadline = new Date(config.trade_deadline)
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of day

    if (today > deadline) {
      return { valid: false, error: 'Trade deadline has passed' }
    }
  }

  return { valid: true }
}

/**
 * Validate a team owns everything it is putting on the table: its roster
 * holdings are still its own and undropped, and its counterpicks are still
 * counterpicked by it.
 *
 * Ownership only. Whether an item may land where the trade is sending it is
 * the separate question `validateCounterpickPlacement` answers, because that
 * one cannot be decided from one side of the deal alone.
 *
 * A counterpick has no dropped_at to check: it deliberately survives a drop of
 * the movie it targets and keeps scoring (see
 * recalculate_team_score_with_counterpicks), so a row that still exists is
 * still worth points and still tradeable.
 */
export async function validateMovieOwnership(
  supabase: SupabaseClient,
  teamId: string,
  items: TradeItems
): Promise<ValidationResult> {
  for (const movie of items.movies) {
    // The title comes from the same row we already have to read for ownership,
    // so naming the movie in the error costs no extra query. `movie.title` is
    // the fallback for an item that was enriched at propose time but whose row
    // has since vanished.
    const invalid = [movie.source_id]

    if (movie.source === 'counterpick') {
      const { data, error } = await supabase
        .from('counterpicks')
        .select('id, counterpicker_team_id, movies(title)')
        .eq('id', movie.source_id)
        .single()

      const title = (data?.movies as unknown as { title: string } | null)?.title ?? movie.title

      if (error || !data) {
        return {
          valid: false,
          error: `${capitalize(tradeItemPhrase('counterpick', title))} is no longer available to trade.`,
          invalidSourceIds: invalid,
        }
      }
      if (data.counterpicker_team_id !== teamId) {
        return {
          valid: false,
          error: `${capitalize(tradeItemPhrase('counterpick', title))} is no longer owned by that team, so it can't be traded.`,
          invalidSourceIds: invalid,
        }
      }
      continue
    }

    const table = movie.source === 'draft_pick' ? 'draft_picks' : 'pickups'

    const { data, error } = await supabase
      .from(table)
      .select('id, team_id, dropped_at, movies(title)')
      .eq('id', movie.source_id)
      .single()

    const title = (data?.movies as unknown as { title: string } | null)?.title ?? movie.title

    if (error || !data) {
      return {
        valid: false,
        error: `${quoteTitle(title)} is no longer available to trade.`,
        invalidSourceIds: invalid,
      }
    }
    if (data.team_id !== teamId) {
      return {
        valid: false,
        error: `${quoteTitle(title)} is no longer on that team's roster, so it can't be traded.`,
        invalidSourceIds: invalid,
      }
    }
    if (data.dropped_at) {
      return {
        valid: false,
        error: `${quoteTitle(title)} has been dropped and can no longer be traded.`,
        invalidSourceIds: invalid,
      }
    }
  }

  return { valid: true }
}

/** Sentence-case a phrase that may start with a lowercase article. */
function capitalize(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** A counterpick, as much of it as the placement and slot checks need. */
interface DisturbedCounterpick {
  id: string
  counterpicker_team_id: string
  target_team_id: string
  draft_pick_id: string | null
  pickup_id: string | null
  phase: 'draft' | 'bidding'
  /** Embedded so a placement error can name the movie rather than an id. */
  movies: { title: string } | null
}

/** Where each item in a trade ends up, keyed by source_id. */
function destinationsBySourceId(
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems,
  matches: (item: TradeMovieItem) => boolean
): Map<string, string> {
  const destinations = new Map<string, string>()
  for (const item of initiatorItems.movies) {
    if (matches(item)) destinations.set(item.source_id, recipientTeamId)
  }
  for (const item of recipientItems.movies) {
    if (matches(item)) destinations.set(item.source_id, initiatorTeamId)
  }
  return destinations
}

/**
 * Every counterpick this trade could disturb: the ones changing hands, plus the
 * ones sitting on a movie that is changing hands.
 */
async function loadDisturbedCounterpicks(
  supabase: SupabaseClient,
  counterpickIds: string[],
  draftPickIds: string[],
  pickupIds: string[]
): Promise<DisturbedCounterpick[]> {
  const columns =
    'id, counterpicker_team_id, target_team_id, draft_pick_id, pickup_id, phase, movies(title)'
  // PromiseLike, not Promise: a PostgrestFilterBuilder is thenable but is not a
  // Promise until it is awaited. The row type is asserted at the merge below --
  // supabase-js infers the embed's shape from the select string and does not
  // land on DisturbedCounterpick's `movies`.
  // deno-lint-ignore no-explicit-any
  const lookups: Array<PromiseLike<{ data: any[] | null }>> = []

  if (counterpickIds.length > 0) {
    lookups.push(supabase.from('counterpicks').select(columns).in('id', counterpickIds))
  }
  if (draftPickIds.length > 0) {
    lookups.push(supabase.from('counterpicks').select(columns).in('draft_pick_id', draftPickIds))
  }
  if (pickupIds.length > 0) {
    lookups.push(supabase.from('counterpicks').select(columns).in('pickup_id', pickupIds))
  }

  const results = await Promise.all(lookups)
  const byId = new Map<string, DisturbedCounterpick>()
  for (const { data } of results) {
    for (const row of (data ?? []) as DisturbedCounterpick[]) byId.set(row.id, row)
  }
  return [...byId.values()]
}

/**
 * Reject any trade that would leave one team holding both a movie and the
 * counterpick against it. `counterpicks_not_own_movie` forbids
 * counterpicker_team_id == target_team_id at the DB layer, and betting against
 * your own holding is not a coherent bet in the first place.
 *
 * Judged on POST-trade ownership, which matters in both directions:
 *   - a movie sent to the team that counterpicked it is rejected...
 *   - ...unless that same trade sends the counterpick the other way, which is a
 *     perfectly sensible swap and is allowed.
 *
 * This is a UX-earlier mirror of the authoritative guard inside execute_trade()
 * (see 20260822120000_allow_trading_counterpicks.sql), which runs under the
 * trade row lock and is what actually protects the data. The two are worded
 * identically on purpose -- the SQL wording is what a commissioner sees when
 * ownership changes between the two checks.
 *
 * One deliberate difference from the SQL: post-trade holder is derived from
 * counterpicks.target_team_id, which tracks the current holder by contract
 * (execute_trade retargets it on every transfer), rather than re-reading
 * draft_picks/pickups.
 */
export async function validateCounterpickPlacement(
  supabase: SupabaseClient,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): Promise<ValidationResult> {
  const counterpickMoves = destinationsBySourceId(
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems,
    (item) => item.source === 'counterpick'
  )
  const holdingMoves = destinationsBySourceId(
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems,
    isRosterItem
  )

  const movingDraftPickIds = [...initiatorItems.movies, ...recipientItems.movies]
    .filter((item) => item.source === 'draft_pick')
    .map((item) => item.source_id)
  const movingPickupIds = [...initiatorItems.movies, ...recipientItems.movies]
    .filter((item) => item.source === 'pickup')
    .map((item) => item.source_id)

  const disturbed = await loadDisturbedCounterpicks(
    supabase,
    [...counterpickMoves.keys()],
    movingDraftPickIds,
    movingPickupIds
  )

  for (const counterpick of disturbed) {
    const holdingId = counterpick.draft_pick_id ?? counterpick.pickup_id
    const postCounterpicker =
      counterpickMoves.get(counterpick.id) ?? counterpick.counterpicker_team_id
    const postHolder =
      (holdingId ? holdingMoves.get(holdingId) : undefined) ?? counterpick.target_team_id

    if (postCounterpicker !== postHolder) continue

    // Both messages name the receiving team and lead with what it already
    // holds, because that -- not the item being sent -- is the reason.
    const title = counterpick.movies?.title
    const blockingTeam = await getTeamName(supabase, postHolder)

    return counterpickMoves.has(counterpick.id)
      ? {
          valid: false,
          error: `${blockingTeam} holds ${quoteTitle(title)}, so they can't also hold the counterpick on it.`,
          invalidSourceIds: [counterpick.id],
        }
      : {
          valid: false,
          error: `${blockingTeam} holds the counterpick on ${quoteTitle(title)}, so they can't also hold the movie.`,
          invalidSourceIds: holdingId ? [holdingId] : [],
        }
  }

  return { valid: true }
}

/**
 * Counterpicks occupy their own per-phase slots
 * (`leagues.draft_counterpick_slots` / `bidding_counterpick_slots`), the same
 * scarce resource process-bids rations when awarding counterpick bids. A trade
 * must respect them, or a team could buy up every counterpick in the league.
 *
 * Counted per phase because that is how the slots are configured and how
 * process-bids spends them -- a draft-phase counterpick arriving by trade does
 * not free a bidding-phase slot.
 */
export async function validateCounterpickSlots(
  supabase: SupabaseClient,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems,
  config: LeagueTradeConfig
): Promise<ValidationResult> {
  const tradedIds = [...initiatorItems.movies, ...recipientItems.movies]
    .filter((item) => item.source === 'counterpick')
    .map((item) => item.source_id)

  if (tradedIds.length === 0) return { valid: true }

  const [{ data: traded }, { data: held }] = await Promise.all([
    supabase.from('counterpicks').select('id, phase').in('id', tradedIds),
    supabase
      .from('counterpicks')
      .select('counterpicker_team_id, phase')
      .in('counterpicker_team_id', [initiatorTeamId, recipientTeamId]),
  ])

  const phaseOf = new Map<string, 'draft' | 'bidding'>(
    (traded ?? []).map((row: { id: string; phase: 'draft' | 'bidding' }) => [row.id, row.phase])
  )

  // Current holdings, then the trade's effect on them.
  const counts = new Map<string, number>()
  const key = (teamId: string, phase: string) => `${teamId}:${phase}`
  const bump = (teamId: string, phase: string, delta: number) =>
    counts.set(key(teamId, phase), (counts.get(key(teamId, phase)) ?? 0) + delta)

  for (const row of (held ?? []) as Array<{ counterpicker_team_id: string; phase: string }>) {
    bump(row.counterpicker_team_id, row.phase, 1)
  }

  const applyMove = (items: TradeItems, from: string, to: string) => {
    for (const item of items.movies) {
      if (item.source !== 'counterpick') continue
      const phase = phaseOf.get(item.source_id)
      if (!phase) continue
      bump(from, phase, -1)
      bump(to, phase, 1)
    }
  }
  applyMove(initiatorItems, initiatorTeamId, recipientTeamId)
  applyMove(recipientItems, recipientTeamId, initiatorTeamId)

  const limits: Array<{ phase: 'draft' | 'bidding'; limit: number; label: string }> = [
    { phase: 'draft', limit: config.draft_counterpick_slots, label: 'draft counterpicks' },
    { phase: 'bidding', limit: config.bidding_counterpick_slots, label: 'bidding counterpicks' },
  ]

  for (const teamId of [initiatorTeamId, recipientTeamId]) {
    for (const { phase, limit, label } of limits) {
      const count = counts.get(key(teamId, phase)) ?? 0
      if (count > limit) {
        return {
          valid: false,
          error: `This trade would leave ${await getTeamName(supabase, teamId)} with ${count} ${label}, over the league limit of ${limit}.`,
        }
      }
    }
  }

  return { valid: true }
}

/**
 * Validate team has enough fantasy budget
 */
export function validateBudget(
  remainingBudget: number,
  budgetAmount: number
): ValidationResult {
  if (budgetAmount > remainingBudget) {
    return {
      valid: false,
      error: `Insufficient budget. Have $${remainingBudget}, trying to trade $${budgetAmount}`
    }
  }
  return { valid: true }
}

/**
 * Validate both teams will have valid roster sizes after trade.
 *
 * Counterpick items are excluded from the count on both sides: they occupy
 * counterpick slots, not roster slots, and `get_team_movie_count` (the current
 * count this is compared against) counts only draft_picks and pickups. Their
 * capacity is `validateCounterpickSlots`'s job.
 */
export async function validateRosterSpace(
  supabase: SupabaseClient,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems,
  totalSlots: number
): Promise<ValidationResult> {
  // Get current movie counts
  const { data: initiatorCount } = await supabase.rpc('get_team_movie_count', {
    p_team_id: initiatorTeamId
  })

  const { data: recipientCount } = await supabase.rpc('get_team_movie_count', {
    p_team_id: recipientTeamId
  })

  const initiatorMovieCount = initiatorCount ?? 0
  const recipientMovieCount = recipientCount ?? 0

  // Calculate post-trade counts. What one side gives, the other receives.
  const initiatorGiving = initiatorItems.movies.filter(isRosterItem).length
  const recipientGiving = recipientItems.movies.filter(isRosterItem).length

  const newInitiatorCount = initiatorMovieCount - initiatorGiving + recipientGiving
  const newRecipientCount = recipientMovieCount - recipientGiving + initiatorGiving

  for (const { teamId, count } of [
    { teamId: initiatorTeamId, count: newInitiatorCount },
    { teamId: recipientTeamId, count: newRecipientCount },
  ]) {
    if (count > totalSlots) {
      return {
        valid: false,
        error: `This trade would leave ${await getTeamName(supabase, teamId)} with ${count} movies, over the league limit of ${totalSlots}.`,
      }
    }
  }

  return { valid: true }
}

/**
 * Get team info including league_id and budget
 */
export async function getTeamInfo(
  supabase: SupabaseClient,
  teamId: string
): Promise<TeamInfo | null> {
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select(`
      id,
      name,
      participant_id,
      league_participants!inner(league_id, user_id)
    `)
    .eq('id', teamId)
    .single()

  if (teamError || !team) return null

  const { data: budget } = await supabase
    .from('team_budgets')
    .select('remaining_budget')
    .eq('team_id', teamId)
    .single()

  const participant = team.league_participants as unknown as { league_id: string; user_id: string }

  return {
    id: team.id,
    name: team.name,
    league_id: participant.league_id,
    user_id: participant.user_id,
    remaining_budget: budget?.remaining_budget ?? 100,
  }
}

/**
 * Get league trade configuration
 */
export async function getLeagueTradeConfig(
  supabase: SupabaseClient,
  leagueId: string
): Promise<(LeagueTradeConfig & { status: string }) | null> {
  const { data, error } = await supabase
    .from('leagues')
    .select('status, trades_enabled, trade_deadline, trade_veto_hours, trade_review_enabled, total_slots, faab_budget, draft_counterpick_slots, bidding_counterpick_slots')
    .eq('id', leagueId)
    .single()

  if (error || !data) return null

  // Default faab_budget to 100 if not set (for backwards compatibility)
  return {
    ...data,
    faab_budget: data.faab_budget ?? 100,
    // A league with counterpicks switched off has no slots, so any counterpick
    // item fails the capacity check -- correct, since it could not have one.
    draft_counterpick_slots: data.draft_counterpick_slots ?? 0,
    bidding_counterpick_slots: data.bidding_counterpick_slots ?? 0,
  } as LeagueTradeConfig & { status: string }
}

/**
 * Validate a trade proposal completely
 */
export async function validateTradeProposal(
  supabase: SupabaseClient,
  leagueId: string,
  initiatorTeamId: string,
  recipientTeamId: string,
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): Promise<ValidationResult> {
  // 1. Get league config first (needed for budget validation)
  const config = await getLeagueTradeConfig(supabase, leagueId)
  if (!config) {
    return { valid: false, error: 'League not found' }
  }

  // 2. Validate items structure (using the league's fantasy budget)
  let result = validateTradeItemsStructure(initiatorItems, config.faab_budget)
  if (!result.valid) return result

  result = validateTradeItemsStructure(recipientItems, config.faab_budget)
  if (!result.valid) return result

  // 3. Validate trade not empty
  result = validateTradeNotEmpty(initiatorItems, recipientItems)
  if (!result.valid) return result

  // 4. Validate trading enabled
  result = validateLeagueTradingEnabled(config, config.status)
  if (!result.valid) return result

  // 5. Get team info
  const initiatorInfo = await getTeamInfo(supabase, initiatorTeamId)
  const recipientInfo = await getTeamInfo(supabase, recipientTeamId)

  if (!initiatorInfo) {
    return { valid: false, error: 'Initiator team not found' }
  }
  if (!recipientInfo) {
    return { valid: false, error: 'Recipient team not found' }
  }

  // 6. Validate teams are in the same league
  if (initiatorInfo.league_id !== leagueId || recipientInfo.league_id !== leagueId) {
    return { valid: false, error: 'Both teams must be in the same league' }
  }

  // 7. Validate ownership of every item each side is giving up
  result = await validateMovieOwnership(supabase, initiatorTeamId, initiatorItems)
  if (!result.valid) return result

  result = await validateMovieOwnership(supabase, recipientTeamId, recipientItems)
  if (!result.valid) return result

  // 7b. Validate no team ends up holding both a movie and the bet against it
  result = await validateCounterpickPlacement(
    supabase,
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems
  )
  if (!result.valid) return result

  // 8. Validate fantasy budgets
  result = validateBudget(initiatorInfo.remaining_budget, initiatorItems.faab)
  if (!result.valid) return result

  result = validateBudget(recipientInfo.remaining_budget, recipientItems.faab)
  if (!result.valid) return result

  // 9. Validate roster space
  result = await validateRosterSpace(
    supabase,
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems,
    config.total_slots
  )
  if (!result.valid) return result

  // 10. Validate counterpick slot capacity
  result = await validateCounterpickSlots(
    supabase,
    initiatorTeamId,
    recipientTeamId,
    initiatorItems,
    recipientItems,
    config
  )
  if (!result.valid) return result

  return { valid: true, config }
}

interface MovieData {
  title: string
  poster_url: string | null
  release_date: string | null
}

/** The table a trade item's source_id is a primary key in. */
function sourceTable(source: TradeItemSource): 'draft_picks' | 'pickups' | 'counterpicks' {
  if (source === 'draft_pick') return 'draft_picks'
  if (source === 'pickup') return 'pickups'
  return 'counterpicks'
}

/**
 * Format trade items for display (enrich with movie data)
 */
export async function enrichTradeItems(
  supabase: SupabaseClient,
  items: TradeItems
): Promise<TradeItems> {
  const enrichedMovies: TradeMovieItem[] = []

  for (const movie of items.movies) {
    // Every source reaches its movie through the same embed -- counterpicks
    // carry movie_id directly, holdings carry it on the base row.
    const { data } = await supabase
      .from(sourceTable(movie.source))
      .select('movies(title, poster_url, release_date)')
      .eq('id', movie.source_id)
      .single()

    const movieData = (data?.movies as unknown as MovieData) ?? null

    enrichedMovies.push({
      ...movie,
      title: movieData?.title ?? 'Unknown Movie',
      poster_url: movieData?.poster_url ?? null,
      release_date: movieData?.release_date ?? null,
    })
  }

  return {
    movies: enrichedMovies,
    faab: items.faab,
  }
}

// ============================================================================
// Email Notification Helpers
// ============================================================================

interface TradePartyInfo {
  userId: string
  email: string
  teamName: string
}

/**
 * Get user email and team name for a team
 */
async function getTradePartyInfo(
  supabase: SupabaseClient,
  teamId: string
): Promise<TradePartyInfo | null> {
  const { data: team } = await supabase
    .from('teams')
    .select(`
      name,
      league_participants!inner(user_id)
    `)
    .eq('id', teamId)
    .single()

  if (!team) return null

  const participant = team.league_participants as unknown as { user_id: string }

  // Get user email from auth.users via RPC or profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', participant.user_id)
    .single()

  // If profile doesn't have email, try auth.users
  if (!profile?.email) {
    const { data: authUser } = await supabase.auth.admin.getUserById(participant.user_id)
    if (!authUser?.user?.email) return null

    return {
      userId: participant.user_id,
      email: authUser.user.email,
      teamName: team.name,
    }
  }

  return {
    userId: participant.user_id,
    email: profile.email,
    teamName: team.name,
  }
}

/**
 * Get league name and URL
 */
async function getLeagueInfo(
  supabase: SupabaseClient,
  leagueId: string
): Promise<{ name: string; url: string } | null> {
  const { data } = await supabase
    .from('leagues')
    .select('name')
    .eq('id', leagueId)
    .single()

  if (!data) return null

  const appUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  return {
    name: data.name,
    url: `${appUrl}/league/${leagueId}`,
  }
}

/**
 * Format trade items to string for email display
 */
async function formatItemsForEmail(
  supabase: SupabaseClient,
  items: TradeItems
): Promise<string> {
  const movieTitles: string[] = []

  for (const movie of items.movies) {
    const { data } = await supabase
      .from(sourceTable(movie.source))
      .select('movies(title)')
      .eq('id', movie.source_id)
      .single()

    const movieData = data?.movies as unknown as { title: string } | null
    movieTitles.push(tradeItemLabel({ ...movie, title: movieData?.title }))
  }

  return formatTradeItemsForEmail(movieTitles, items.faab)
}

/**
 * Send trade email notifications to one or both parties
 * Now with delivery tracking for observability
 */
export async function sendTradeEmailNotifications(
  supabase: SupabaseClient,
  tradeOffer: TradeOffer,
  emailType: TradeEmailType,
  options?: {
    notifyInitiator?: boolean
    notifyRecipient?: boolean
    message?: string
    vetoReason?: string
    /** Why an expired offer expired, already phrased for a reader. */
    expiredReason?: string
  }
): Promise<void> {
  const {
    notifyInitiator = false,
    notifyRecipient = false,
    message,
    vetoReason,
    expiredReason,
  } = options ?? {}

  if (!notifyInitiator && !notifyRecipient) return

  try {
    // Get league info
    const leagueInfo = await getLeagueInfo(supabase, tradeOffer.league_id)
    if (!leagueInfo) {
      console.warn('Could not get league info for trade email')
      return
    }

    // Get party info
    const initiatorInfo = notifyInitiator
      ? await getTradePartyInfo(supabase, tradeOffer.initiator_team_id)
      : null
    const recipientInfo = notifyRecipient
      ? await getTradePartyInfo(supabase, tradeOffer.recipient_team_id)
      : null

    // Format items
    const initiatorItemsStr = await formatItemsForEmail(supabase, tradeOffer.initiator_items)
    const recipientItemsStr = await formatItemsForEmail(supabase, tradeOffer.recipient_items)

    // Build metadata for logging
    const baseMetadata = {
      league_id: tradeOffer.league_id,
      league_name: leagueInfo.name,
      email_type: emailType,
    }

    // Send to initiator if requested
    if (initiatorInfo) {
      const recipientName = recipientInfo?.teamName ?? await getTeamName(supabase, tradeOffer.recipient_team_id)

      const emailData: TradeEmailData = {
        recipientEmail: initiatorInfo.email,
        recipientTeamName: initiatorInfo.teamName,
        otherTeamName: recipientName,
        leagueName: leagueInfo.name,
        leagueUrl: leagueInfo.url,
        // From initiator's perspective: they offered initiator_items, requesting recipient_items
        offeredItems: initiatorItemsStr,
        requestedItems: recipientItemsStr,
        message,
        vetoReason,
        reviewEndsAt: tradeOffer.review_ends_at ?? undefined,
        expiresAt: tradeOffer.expires_at ?? undefined,
        expiredReason,
      }

      const result = await sendTradeEmail(emailType, emailData)

      // Log the delivery result
      await logNotificationDelivery(supabase, {
        tradeOfferId: tradeOffer.id,
        notificationType: `trade_${emailType}`,
        recipientEmail: initiatorInfo.email,
        recipientUserId: initiatorInfo.userId,
        status: statusFromEmailResult(result),
        messageId: result.messageId,
        errorMessage: result.error,
        metadata: { ...baseMetadata, recipient_team_name: initiatorInfo.teamName, party: 'initiator' },
      })
    }

    // Send to recipient if requested
    if (recipientInfo) {
      const initiatorName = initiatorInfo?.teamName ?? await getTeamName(supabase, tradeOffer.initiator_team_id)

      const emailData: TradeEmailData = {
        recipientEmail: recipientInfo.email,
        recipientTeamName: recipientInfo.teamName,
        otherTeamName: initiatorName,
        leagueName: leagueInfo.name,
        leagueUrl: leagueInfo.url,
        // From recipient's perspective: they're being offered initiator_items in exchange for recipient_items
        offeredItems: initiatorItemsStr,
        requestedItems: recipientItemsStr,
        message,
        vetoReason,
        reviewEndsAt: tradeOffer.review_ends_at ?? undefined,
        expiresAt: tradeOffer.expires_at ?? undefined,
        expiredReason,
      }

      const result = await sendTradeEmail(emailType, emailData)

      // Log the delivery result
      await logNotificationDelivery(supabase, {
        tradeOfferId: tradeOffer.id,
        notificationType: `trade_${emailType}`,
        recipientEmail: recipientInfo.email,
        recipientUserId: recipientInfo.userId,
        status: statusFromEmailResult(result),
        messageId: result.messageId,
        errorMessage: result.error,
        metadata: { ...baseMetadata, recipient_team_name: recipientInfo.teamName, party: 'recipient' },
      })
    }
  } catch (error) {
    // Non-blocking: log and continue
    console.error('Error sending trade email notifications:', error)
  }
}
