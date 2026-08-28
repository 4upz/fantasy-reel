import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { MIN_NEW_BID_CUTOFF_HOURS, MAX_NEW_BID_CUTOFF_HOURS } from '../_shared/bid-window.ts'
import { deriveExpiryBounds, type LeagueExpiryConfig } from '../_shared/trade-expiry.ts'
import { completeLeague } from '../_shared/league-completion.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('update-league')

type Action = 'update_info' | 'update_draft_config' | 'update_bidding_config' | 'update_counterpick_config' | 'update_trade_config' | 'update_season_config' | 'randomize_draft_order' | 'reorder_participants' | 'kick_participant' | 'delete_league' | 'complete_league'

interface UpdateInfoRequest {
  action: 'update_info'
  league_id: string
  name?: string
  invite_only?: boolean
}

interface UpdateDraftConfigRequest {
  action: 'update_draft_config'
  league_id: string
  max_participants?: number
}

interface UpdateBiddingConfigRequest {
  action: 'update_bidding_config'
  league_id: string
  total_slots?: number
  draft_slots?: number
  drop_limit?: number
  counterbid_hours?: number
  new_bid_cutoff_hours?: number
}

interface KickParticipantRequest {
  action: 'kick_participant'
  league_id: string
  participant_id: string
}

interface DeleteLeagueRequest {
  action: 'delete_league'
  league_id: string
}

interface CompleteLeagueRequest {
  action: 'complete_league'
  league_id: string
}

interface UpdateCounterpickConfigRequest {
  action: 'update_counterpick_config'
  league_id: string
  draft_counterpick_slots?: number
  bidding_counterpick_slots?: number
  counterpicks_block_drops?: boolean
}

interface UpdateTradeConfigRequest {
  action: 'update_trade_config'
  league_id: string
  trades_enabled?: boolean
  /** Bare date (YYYY-MM-DD), inclusive. null clears the deadline. */
  trade_deadline?: string | null
  trade_review_enabled?: boolean
  trade_veto_hours?: number
  /** null on any of the three restores the app default. */
  trade_offer_expiry_default_hours?: number | null
  trade_offer_expiry_min_hours?: number | null
  trade_offer_expiry_max_days?: number | null
}

interface UpdateSeasonConfigRequest {
  action: 'update_season_config'
  league_id: string
  /** The season label, e.g. 2027. Only editable while the league is in setup. */
  season_year?: number
  /** Bare date (YYYY-MM-DD). The day the season stops scoring. */
  season_end?: string
}

interface RandomizeDraftOrderRequest {
  action: 'randomize_draft_order'
  league_id: string
}

interface ReorderParticipantsRequest {
  action: 'reorder_participants'
  league_id: string
  participant_order: string[]
}

type UpdateLeagueRequest =
  | UpdateInfoRequest
  | UpdateDraftConfigRequest
  | UpdateBiddingConfigRequest
  | UpdateCounterpickConfigRequest
  | UpdateTradeConfigRequest
  | UpdateSeasonConfigRequest
  | RandomizeDraftOrderRequest
  | ReorderParticipantsRequest
  | KickParticipantRequest
  | DeleteLeagueRequest
  | CompleteLeagueRequest

const MAX_NAME_LENGTH = 255
const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 20

// Bidding config constraints
const MIN_TOTAL_SLOTS = 1
const MAX_TOTAL_SLOTS = 20
const MIN_DRAFT_SLOTS = 1
const MIN_DROP_LIMIT = 0
const MAX_DROP_LIMIT = 10
const MIN_COUNTERBID_HOURS = 1
const MAX_COUNTERBID_HOURS = 72

// Counterpick config constraints
const MIN_COUNTERPICK_SLOTS = 0
const MAX_COUNTERPICK_SLOTS = 5

// Trade config constraints. The veto bounds match check_trade_veto_hours on the
// table; the expiry bounds match the three CHECKs added in
// 20260827120000_league_trade_expiry_config.sql. Both are restated here so a
// bad value comes back as a readable 400 instead of a constraint violation
// surfacing as a 500.
const MIN_TRADE_VETO_HOURS = 0
const MAX_TRADE_VETO_HOURS = 168
const MIN_EXPIRY_DEFAULT_HOURS = 1
const MAX_EXPIRY_DEFAULT_HOURS = 2160
const MIN_EXPIRY_MIN_HOURS = 1
const MAX_EXPIRY_MIN_HOURS = 168
const MIN_EXPIRY_MAX_DAYS = 1
const MAX_EXPIRY_MAX_DAYS = 90

// Season config constraints. The year bounds are a typo guard, not a policy --
// a season label outside this range is a mis-typed date, not a real league.
const MIN_SEASON_YEAR = 2000
const MAX_SEASON_YEAR = 2100

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** True for a real YYYY-MM-DD date (rejects e.g. 2026-02-31). */
function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

/** Today in UTC as YYYY-MM-DD, so date-only values compare as strings. */
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase } = authResult

    const body: UpdateLeagueRequest = await req.json()
    const { action, league_id } = body

    // Validate league_id
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    // Fetch league and verify ownership
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can modify settings', 403)
    }

    // Route to action handler
    switch (action) {
      case 'update_info':
        return await handleUpdateInfo(supabase, league, body as UpdateInfoRequest)

      case 'update_draft_config':
        return await handleUpdateDraftConfig(supabase, league, body as UpdateDraftConfigRequest)

      case 'update_bidding_config':
        return await handleUpdateBiddingConfig(supabase, league, body as UpdateBiddingConfigRequest)

      case 'update_counterpick_config':
        return await handleUpdateCounterpickConfig(supabase, league, body as UpdateCounterpickConfigRequest)

      case 'update_trade_config':
        return await handleUpdateTradeConfig(supabase, league, body as UpdateTradeConfigRequest)

      case 'randomize_draft_order':
        return await handleRandomizeDraftOrder(supabase, league)

      case 'reorder_participants':
        return await handleReorderParticipants(supabase, league, body as ReorderParticipantsRequest)

      case 'kick_participant':
        return await handleKickParticipant(supabase, league, user.id, body as KickParticipantRequest)

      case 'delete_league':
        return await handleDeleteLeague(supabase, league)

      case 'update_season_config':
        return await handleUpdateSeasonConfig(supabase, league, body as UpdateSeasonConfigRequest)

      case 'complete_league':
        return await handleCompleteLeague(league)

      default:
        return errorResponse('Invalid action', 400)
    }
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})

/**
 * League name and invite-only.
 *
 * The name belongs to the SERIES, not the season: "League" is what spans
 * years, and renaming it has to rename every season under it or the history
 * list reads like two different leagues. So the name is written to
 * `league_series`, and the `sync_series_name_to_seasons` trigger pushes it down
 * to `leagues.name` -- which is a denormalized copy, not the source of truth.
 * `invite_only` really is per-season and stays on `leagues`.
 */
async function handleUpdateInfo(
  supabase: SupabaseClient,
  league: { id: string; series_id: string },
  body: UpdateInfoRequest
): Promise<Response> {
  let trimmedName: string | undefined

  if (body.name !== undefined) {
    trimmedName = body.name.trim()
    if (trimmedName.length === 0) {
      return errorResponse('League name cannot be empty', 400)
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return errorResponse(`League name cannot exceed ${MAX_NAME_LENGTH} characters`, 400)
    }
  }

  const leagueUpdates: Record<string, unknown> = {}
  if (body.invite_only !== undefined) {
    leagueUpdates.invite_only = body.invite_only
  }

  if (trimmedName === undefined && Object.keys(leagueUpdates).length === 0) {
    return errorResponse('No valid fields to update', 400)
  }

  if (trimmedName !== undefined) {
    // RLS on league_series restricts this to the series owner, who is the
    // league owner the caller was already checked against.
    const { error: seriesError } = await supabase
      .from('league_series')
      .update({ name: trimmedName })
      .eq('id', league.series_id)

    if (seriesError) {
      console.error('Error updating series name:', seriesError)
      return errorResponse('Failed to update league', 500)
    }
  }

  if (Object.keys(leagueUpdates).length > 0) {
    const { error } = await supabase
      .from('leagues')
      .update(leagueUpdates)
      .eq('id', league.id)

    if (error) {
      console.error('Error updating league:', error)
      return errorResponse('Failed to update league', 500)
    }
  }

  // Re-read rather than using the UPDATE's RETURNING: the name arrives on
  // `leagues` via the trigger, so the row returned by the leagues update above
  // would still carry the old name.
  const { data: updatedLeague, error: readError } = await supabase
    .from('leagues')
    .select()
    .eq('id', league.id)
    .single()

  if (readError) {
    console.error('Error reading updated league:', readError)
    return errorResponse('Failed to update league', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'League updated successfully' })
}

async function handleUpdateDraftConfig(
  supabase: SupabaseClient,
  league: { id: string; status: string; max_participants: number },
  body: UpdateDraftConfigRequest
): Promise<Response> {
  // Only allow in setup status
  if (league.status !== 'setup') {
    return errorResponse('Draft configuration can only be changed before the draft starts', 400)
  }

  const updates: Record<string, unknown> = {}

  // Validate max_participants
  if (body.max_participants !== undefined) {
    if (body.max_participants < MIN_PARTICIPANTS || body.max_participants > MAX_PARTICIPANTS) {
      return errorResponse(`Max participants must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}`, 400)
    }

    // Check current participant count
    const { count, error: countError } = await supabase
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league.id)
      .eq('status', 'active')

    if (countError) {
      console.error('Error counting participants:', countError)
      return errorResponse('Failed to validate participant count', 500)
    }

    if (count !== null && body.max_participants < count) {
      return errorResponse(`Cannot set max participants below current count (${count})`, 400)
    }

    updates.max_participants = body.max_participants
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400)
  }

  const { data: updatedLeague, error } = await supabase
    .from('leagues')
    .update(updates)
    .eq('id', league.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating league:', error)
    return errorResponse('Failed to update league', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'Draft configuration updated successfully' })
}

async function handleUpdateBiddingConfig(
  supabase: SupabaseClient,
  league: { id: string; status: string },
  body: UpdateBiddingConfigRequest
): Promise<Response> {
  // Only allow in setup status
  if (league.status !== 'setup') {
    return errorResponse('Bidding configuration can only be changed before the draft starts', 400)
  }

  const updates: Record<string, unknown> = {}

  // Validate total_slots
  if (body.total_slots !== undefined) {
    if (body.total_slots < MIN_TOTAL_SLOTS || body.total_slots > MAX_TOTAL_SLOTS) {
      return errorResponse(`Total slots must be between ${MIN_TOTAL_SLOTS} and ${MAX_TOTAL_SLOTS}`, 400)
    }
    updates.total_slots = body.total_slots
  }

  // Validate draft_slots
  if (body.draft_slots !== undefined) {
    if (body.draft_slots < MIN_DRAFT_SLOTS) {
      return errorResponse(`Draft slots must be at least ${MIN_DRAFT_SLOTS}`, 400)
    }
    // draft_slots must not exceed total_slots (use provided or existing value)
    const totalSlotsValue = body.total_slots ?? (updates.total_slots as number | undefined)
    if (totalSlotsValue !== undefined && body.draft_slots > totalSlotsValue) {
      return errorResponse('Draft slots cannot exceed total slots', 400)
    }
    updates.draft_slots = body.draft_slots
  }

  // Validate drop_limit
  if (body.drop_limit !== undefined) {
    if (body.drop_limit < MIN_DROP_LIMIT || body.drop_limit > MAX_DROP_LIMIT) {
      return errorResponse(`Drop limit must be between ${MIN_DROP_LIMIT} and ${MAX_DROP_LIMIT}`, 400)
    }
    updates.drop_limit = body.drop_limit
  }

  // Validate counterbid_hours
  if (body.counterbid_hours !== undefined) {
    if (body.counterbid_hours < MIN_COUNTERBID_HOURS || body.counterbid_hours > MAX_COUNTERBID_HOURS) {
      return errorResponse(`Counterbid hours must be between ${MIN_COUNTERBID_HOURS} and ${MAX_COUNTERBID_HOURS}`, 400)
    }
    updates.counterbid_hours = body.counterbid_hours
  }

  // Validate new_bid_cutoff_hours (0 disables the cutoff)
  if (body.new_bid_cutoff_hours !== undefined) {
    if (
      !Number.isInteger(body.new_bid_cutoff_hours) ||
      body.new_bid_cutoff_hours < MIN_NEW_BID_CUTOFF_HOURS ||
      body.new_bid_cutoff_hours > MAX_NEW_BID_CUTOFF_HOURS
    ) {
      return errorResponse(
        `New bid cutoff must be a whole number of hours between ${MIN_NEW_BID_CUTOFF_HOURS} and ${MAX_NEW_BID_CUTOFF_HOURS}`,
        400
      )
    }
    updates.new_bid_cutoff_hours = body.new_bid_cutoff_hours
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400)
  }

  const { data: updatedLeague, error } = await supabase
    .from('leagues')
    .update(updates)
    .eq('id', league.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating league:', error)
    return errorResponse('Failed to update league', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'Bidding configuration updated successfully' })
}

async function handleUpdateCounterpickConfig(
  supabase: SupabaseClient,
  league: { id: string; status: string },
  body: UpdateCounterpickConfigRequest
): Promise<Response> {
  // Only allow in setup status
  if (league.status !== 'setup') {
    return errorResponse('Counterpick configuration can only be changed before the draft starts', 400)
  }

  const { draft_counterpick_slots, bidding_counterpick_slots, counterpicks_block_drops } = body
  const updates: Record<string, unknown> = {}

  // Validate draft_counterpick_slots
  if (draft_counterpick_slots !== undefined) {
    if (typeof draft_counterpick_slots !== 'number' ||
        !Number.isInteger(draft_counterpick_slots) ||
        draft_counterpick_slots < MIN_COUNTERPICK_SLOTS ||
        draft_counterpick_slots > MAX_COUNTERPICK_SLOTS) {
      return errorResponse(`draft_counterpick_slots must be an integer between ${MIN_COUNTERPICK_SLOTS} and ${MAX_COUNTERPICK_SLOTS}`, 400)
    }
    updates.draft_counterpick_slots = draft_counterpick_slots
  }

  // Validate bidding_counterpick_slots
  if (bidding_counterpick_slots !== undefined) {
    if (typeof bidding_counterpick_slots !== 'number' ||
        !Number.isInteger(bidding_counterpick_slots) ||
        bidding_counterpick_slots < MIN_COUNTERPICK_SLOTS ||
        bidding_counterpick_slots > MAX_COUNTERPICK_SLOTS) {
      return errorResponse(`bidding_counterpick_slots must be an integer between ${MIN_COUNTERPICK_SLOTS} and ${MAX_COUNTERPICK_SLOTS}`, 400)
    }
    updates.bidding_counterpick_slots = bidding_counterpick_slots
  }

  // Validate counterpicks_block_drops
  if (counterpicks_block_drops !== undefined) {
    if (typeof counterpicks_block_drops !== 'boolean') {
      return errorResponse('counterpicks_block_drops must be a boolean', 400)
    }
    updates.counterpicks_block_drops = counterpicks_block_drops
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No counterpick config fields provided', 400)
  }

  const { data: updatedLeague, error } = await supabase
    .from('leagues')
    .update(updates)
    .eq('id', league.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating counterpick config:', error)
    return errorResponse('Failed to update counterpick config', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'Counterpick configuration updated successfully' })
}

/**
 * Trade settings: the season deadline, the commissioner review window, and the
 * per-offer expiry bounds added in 20260827120000.
 *
 * Deliberately NOT gated on `setup` status, unlike every other config handler
 * here. Trading only happens once a league is active, so a gate that let these
 * be edited only before the draft would mean they could never be edited when
 * they matter -- a commissioner moving the trade deadline mid-season is the
 * normal case, not an escape hatch.
 */
async function handleUpdateTradeConfig(
  supabase: SupabaseClient,
  league: LeagueExpiryConfig & { id: string; season_end: string },
  body: UpdateTradeConfigRequest
): Promise<Response> {
  const updates: Record<string, unknown> = {}

  if (body.trades_enabled !== undefined) {
    if (typeof body.trades_enabled !== 'boolean') {
      return errorResponse('trades_enabled must be a boolean', 400)
    }
    updates.trades_enabled = body.trades_enabled
  }

  if (body.trade_review_enabled !== undefined) {
    if (typeof body.trade_review_enabled !== 'boolean') {
      return errorResponse('trade_review_enabled must be a boolean', 400)
    }
    updates.trade_review_enabled = body.trade_review_enabled
  }

  if (body.trade_deadline !== undefined) {
    if (body.trade_deadline === null) {
      updates.trade_deadline = null
    } else {
      // A bare date, matching the DATE column and the inclusive end-of-day
      // reading in validateLeagueTradingEnabled. Accepting a full timestamp
      // here would store a truncated date silently different from what was sent.
      if (typeof body.trade_deadline !== 'string' || !isValidDateOnly(body.trade_deadline)) {
        return errorResponse('Trade deadline must be a date in YYYY-MM-DD format', 400)
      }
      // Trading past the end of the season is meaningless: the standings are
      // already frozen, and every write path is closed once the season
      // completes. Both dates are YYYY-MM-DD, so a string compare is a date
      // compare.
      if (body.trade_deadline > league.season_end) {
        return errorResponse(
          `The trade deadline cannot fall after the season ends (${league.season_end})`,
          400
        )
      }
      updates.trade_deadline = body.trade_deadline
    }
  }

  if (body.trade_veto_hours !== undefined) {
    if (!Number.isInteger(body.trade_veto_hours) ||
        body.trade_veto_hours < MIN_TRADE_VETO_HOURS ||
        body.trade_veto_hours > MAX_TRADE_VETO_HOURS) {
      return errorResponse(
        `Veto window must be a whole number of hours between ${MIN_TRADE_VETO_HOURS} and ${MAX_TRADE_VETO_HOURS}`,
        400
      )
    }
    updates.trade_veto_hours = body.trade_veto_hours
  }

  // The three expiry bounds share a shape: a whole number in range, or null to
  // fall back to the app default.
  const expiryFields = [
    {
      key: 'trade_offer_expiry_default_hours',
      value: body.trade_offer_expiry_default_hours,
      min: MIN_EXPIRY_DEFAULT_HOURS,
      max: MAX_EXPIRY_DEFAULT_HOURS,
      label: 'Default offer window',
      unit: 'hours',
    },
    {
      key: 'trade_offer_expiry_min_hours',
      value: body.trade_offer_expiry_min_hours,
      min: MIN_EXPIRY_MIN_HOURS,
      max: MAX_EXPIRY_MIN_HOURS,
      label: 'Minimum offer window',
      unit: 'hours',
    },
    {
      key: 'trade_offer_expiry_max_days',
      value: body.trade_offer_expiry_max_days,
      min: MIN_EXPIRY_MAX_DAYS,
      max: MAX_EXPIRY_MAX_DAYS,
      label: 'Maximum offer window',
      unit: 'days',
    },
  ] as const

  for (const field of expiryFields) {
    if (field.value === undefined) continue
    if (field.value === null) {
      updates[field.key] = null
      continue
    }
    if (!Number.isInteger(field.value) || field.value < field.min || field.value > field.max) {
      return errorResponse(
        `${field.label} must be a whole number of ${field.unit} between ${field.min} and ${field.max}`,
        400
      )
    }
    updates[field.key] = field.value
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400)
  }

  // Check the bounds the league will HAVE, not the ones it was sent: an owner
  // narrowing the maximum alone still has to end up with a default inside it,
  // and the fallbacks for whatever they left NULL are part of that answer.
  // deriveExpiryBounds resolves those fallbacks so this and the resolver cannot
  // disagree about what NULL means. Same rule as
  // check_trade_offer_expiry_bounds_ordered -- this is the readable half.
  const effective = deriveExpiryBounds({ ...league, ...updates } as LeagueExpiryConfig)
  const effectiveMinHours = effective.minMinutes / 60
  if (effectiveMinHours > effective.defaultHours ||
      effective.defaultHours > effective.maxDays * 24) {
    return errorResponse(
      `The default offer window (${effective.defaultHours} hours) must be between the minimum ` +
      `(${effectiveMinHours} hours) and the maximum (${effective.maxDays} days)`,
      400
    )
  }

  const { data: updatedLeague, error } = await supabase
    .from('leagues')
    .update(updates)
    .eq('id', league.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating trade config:', error)
    return errorResponse('Failed to update trade configuration', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'Trade configuration updated successfully' })
}

/**
 * The season's own settings: which year it is, and the day it stops scoring.
 *
 * `season_year` is setup-only because it decides movie eligibility -- a league
 * mid-draft that suddenly became a different year would retroactively
 * disqualify movies already on rosters. `season_end` stays editable all
 * season: a commissioner extending or shortening the year is a normal
 * mid-season decision, and it is the date the completion cron reads.
 */
async function handleUpdateSeasonConfig(
  supabase: SupabaseClient,
  league: { id: string; status: string; season_year: number; season_end: string; trade_deadline: string | null },
  body: UpdateSeasonConfigRequest
): Promise<Response> {
  const updates: Record<string, unknown> = {}

  if (body.season_year !== undefined) {
    if (league.status !== 'setup') {
      return errorResponse('The season year can only be changed before the draft starts', 400)
    }
    if (!Number.isInteger(body.season_year) ||
        body.season_year < MIN_SEASON_YEAR ||
        body.season_year > MAX_SEASON_YEAR) {
      return errorResponse(
        `Season year must be a whole number between ${MIN_SEASON_YEAR} and ${MAX_SEASON_YEAR}`,
        400
      )
    }
    updates.season_year = body.season_year
  }

  if (body.season_end !== undefined) {
    if (typeof body.season_end !== 'string' || !isValidDateOnly(body.season_end)) {
      return errorResponse('Season end must be a date in YYYY-MM-DD format', 400)
    }
    updates.season_end = body.season_end
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400)
  }

  // Moving the year without saying anything about the end date has to move the
  // end date too. Otherwise a league relabelled 2026 -> 2027 keeps a
  // season_end of 2026-12-31, which is already in the past, and the completion
  // cron ends the season the night it is created.
  if (updates.season_year !== undefined && updates.season_end === undefined) {
    updates.season_end = `${updates.season_year}-12-31`
  }

  const effectiveSeasonEnd = (updates.season_end ?? league.season_end) as string

  // A season that ends in the past can never be played -- the cron would close
  // it on its next run. Only checked when the date is actually being changed,
  // so an existing league whose end date has already slipped by can still have
  // its other settings edited.
  if (updates.season_end !== undefined && effectiveSeasonEnd < todayDateOnly()) {
    return errorResponse('Season end must be today or later', 400)
  }

  if (league.trade_deadline && league.trade_deadline > effectiveSeasonEnd) {
    return errorResponse(
      `The trade deadline (${league.trade_deadline}) would fall after the season ends (${effectiveSeasonEnd}). Move the trade deadline first.`,
      400
    )
  }

  const { data: updatedLeague, error } = await supabase
    .from('leagues')
    .update(updates)
    .eq('id', league.id)
    .select()
    .single()

  if (error) {
    console.error('Error updating season config:', error)
    return errorResponse('Failed to update season configuration', 500)
  }

  return jsonResponse({ league: updatedLeague, message: 'Season settings updated successfully' })
}

async function handleKickParticipant(
  supabase: SupabaseClient,
  league: { id: string; status: string },
  ownerId: string,
  body: KickParticipantRequest
): Promise<Response> {
  // Only allow in setup status
  if (league.status !== 'setup') {
    return errorResponse('Participants can only be removed before the draft starts', 400)
  }

  const { participant_id } = body

  if (!participant_id || !isValidUUID(participant_id)) {
    return errorResponse('Valid participant_id is required', 400)
  }

  // Fetch the participant
  const { data: participant, error: fetchError } = await supabase
    .from('league_participants')
    .select('*')
    .eq('id', participant_id)
    .eq('league_id', league.id)
    .single()

  if (fetchError || !participant) {
    return errorResponse('Participant not found', 404)
  }

  // Cannot kick the owner
  if (participant.user_id === ownerId) {
    return errorResponse('Cannot remove yourself from the league', 400)
  }

  // Cannot kick already kicked/left participants
  if (participant.status !== 'active') {
    return errorResponse('Participant is not active', 400)
  }

  // Try to get display name from profile (optional)
  let displayName = 'Participant'
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', participant.user_id)
    .single()

  if (profile?.display_name) {
    displayName = profile.display_name
  }

  // Soft delete: set status to 'kicked'
  const { error: updateError } = await supabase
    .from('league_participants')
    .update({ status: 'kicked' })
    .eq('id', participant_id)

  if (updateError) {
    console.error('Error kicking participant:', updateError)
    return errorResponse('Failed to remove participant', 500)
  }

  return jsonResponse({ message: `${displayName} has been removed from the league` })
}

async function handleRandomizeDraftOrder(
  supabase: SupabaseClient,
  league: { id: string; status: string }
): Promise<Response> {
  if (league.status !== 'setup') {
    return errorResponse('Draft order can only be randomized before the draft starts', 400)
  }

  const { error: randomizeError } = await supabase.rpc('randomize_draft_order', {
    p_league_id: league.id,
  })

  if (randomizeError) {
    console.error('Error randomizing draft order:', randomizeError)
    return errorResponse('Failed to randomize draft order', 500)
  }

  const { error: flagError } = await supabase
    .from('leagues')
    .update({ custom_draft_order: true })
    .eq('id', league.id)

  if (flagError) {
    console.error('Error setting custom_draft_order flag:', flagError)
  }

  const { data: participants, error: fetchError } = await supabase
    .from('league_participants')
    .select('id, draft_order')
    .eq('league_id', league.id)
    .eq('status', 'active')
    .order('draft_order', { ascending: true })

  if (fetchError) {
    console.error('Error fetching updated participants:', fetchError)
  }

  return jsonResponse({
    message: 'Draft order randomized successfully',
    participants: participants ?? [],
  })
}

async function handleReorderParticipants(
  supabase: SupabaseClient,
  league: { id: string; status: string },
  body: ReorderParticipantsRequest
): Promise<Response> {
  if (league.status !== 'setup') {
    return errorResponse('Draft order can only be changed before the draft starts', 400)
  }

  const { participant_order } = body

  if (!Array.isArray(participant_order) || participant_order.length === 0) {
    return errorResponse('participant_order must be a non-empty array', 400)
  }

  if (!participant_order.every(isValidUUID)) {
    return errorResponse('All participant IDs must be valid UUIDs', 400)
  }

  // Check for duplicates
  if (new Set(participant_order).size !== participant_order.length) {
    return errorResponse('participant_order contains duplicate IDs', 400)
  }

  // Fetch all active participants for validation
  const { data: participants, error: fetchError } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', league.id)
    .eq('status', 'active')

  if (fetchError) {
    console.error('Error fetching participants:', fetchError)
    return errorResponse('Failed to fetch participants', 500)
  }

  const participantIds = new Set(participants.map((p: { id: string }) => p.id))

  if (participant_order.length !== participantIds.size) {
    return errorResponse('participant_order length must match active participant count', 400)
  }

  if (participant_order.some((id) => !participantIds.has(id))) {
    return errorResponse('Invalid participant IDs provided', 400)
  }

  // Use transactional RPC to update all draft_order values atomically
  const { error: reorderError } = await supabase.rpc('reorder_draft_order', {
    p_league_id: league.id,
    p_participant_order: participant_order,
  })

  if (reorderError) {
    console.error('Error updating draft order:', reorderError)
    return errorResponse('Failed to update draft order', 500)
  }

  const { error: flagError } = await supabase
    .from('leagues')
    .update({ custom_draft_order: true })
    .eq('id', league.id)

  if (flagError) {
    console.error('Error setting custom_draft_order flag:', flagError)
  }

  return jsonResponse({ message: 'Draft order updated successfully' })
}

async function handleDeleteLeague(
  supabase: SupabaseClient,
  league: { id: string; status: string; name: string }
): Promise<Response> {
  // Only allow in setup status
  if (league.status !== 'setup') {
    return errorResponse('League can only be deleted before the draft starts', 400)
  }

  // Delete the league (cascades to participants, teams, picks, invitations)
  const { error } = await supabase
    .from('leagues')
    .delete()
    .eq('id', league.id)

  if (error) {
    console.error('Error deleting league:', error)
    return errorResponse('Failed to delete league', 500)
  }

  return jsonResponse({ message: `League "${league.name}" has been deleted` })
}

/**
 * The commissioner's "End Season" button.
 *
 * All of the work -- final rescore, ranking, stamping the champion, and every
 * announcement -- lives in `completeLeague`, which the nightly
 * `complete-seasons` cron calls with the same arguments. Ending a season by
 * hand and ending it on schedule must do exactly the same thing, so neither
 * path gets its own copy.
 */
async function handleCompleteLeague(league: { id: string }): Promise<Response> {
  // Service role: completion reads discord_channels.webhook_url (a credential
  // column) and writes a notifications row for every participant, neither of
  // which the caller's own client is allowed to do.
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const result = await completeLeague(serviceClient, league.id, { trigger: 'owner' })

  if (!result.ok) {
    return result.reason === 'not_found'
      ? errorResponse('League not found', 404)
      : errorResponse('Only an active league can be marked completed', 400)
  }

  return jsonResponse({
    league: result.league,
    message: 'League marked as completed',
    top_teams: result.standings.slice(0, 3).map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      points: row.total_points,
      rank: row.rank,
    })),
    winner_team_ids: result.winnerTeamIds,
  })
}
