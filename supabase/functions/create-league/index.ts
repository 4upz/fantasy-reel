import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('create-league')

// Validation constants
const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 20
const MIN_TOTAL_SLOTS = 1
const MAX_TOTAL_SLOTS = 20
const MIN_DRAFT_SLOTS = 1
const MIN_DROP_LIMIT = 0
const MAX_DROP_LIMIT = 10
const MIN_COUNTERBID_HOURS = 1
const MAX_COUNTERBID_HOURS = 72
const MIN_COUNTERPICK_SLOTS = 0
const MAX_DRAFT_COUNTERPICK_SLOTS = 5
const MAX_BIDDING_COUNTERPICK_SLOTS = 3

interface CreateLeagueRequest {
  name: string
  invite_only?: boolean
  draft_start_date?: string
  draft_end_date?: string
  max_participants?: number
  team_name?: string
  // Roster configuration
  total_slots?: number
  draft_slots?: number
  drop_limit?: number
  counterbid_hours?: number
  // Counterpick configuration
  draft_counterpick_slots?: number
  bidding_counterpick_slots?: number
  counterpicks_block_drops?: boolean
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create Supabase client with user auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Parse request body
    const {
      name,
      invite_only,
      draft_start_date,
      draft_end_date,
      max_participants,
      team_name,
      // Roster configuration
      total_slots,
      draft_slots,
      drop_limit,
      counterbid_hours,
      // Counterpick configuration
      draft_counterpick_slots,
      bidding_counterpick_slots,
      counterpicks_block_drops,
    }: CreateLeagueRequest = await req.json()

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return errorResponse('League name is required', 400)
    }

    // Validate max_participants bounds
    if (max_participants !== undefined) {
      if (max_participants < MIN_PARTICIPANTS || max_participants > MAX_PARTICIPANTS) {
        return errorResponse(`Max participants must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}`, 400)
      }
    }

    // Validate total_slots bounds
    if (total_slots !== undefined) {
      if (total_slots < MIN_TOTAL_SLOTS || total_slots > MAX_TOTAL_SLOTS) {
        return errorResponse(`Total slots must be between ${MIN_TOTAL_SLOTS} and ${MAX_TOTAL_SLOTS}`, 400)
      }
    }

    // Validate draft_slots minimum
    if (draft_slots !== undefined) {
      if (draft_slots < MIN_DRAFT_SLOTS) {
        return errorResponse(`Draft slots must be at least ${MIN_DRAFT_SLOTS}`, 400)
      }
    }

    // Cross-field validation: draft_slots cannot exceed total_slots
    if (draft_slots !== undefined && total_slots !== undefined) {
      if (draft_slots > total_slots) {
        return errorResponse('Draft slots cannot exceed total slots', 400)
      }
    }

    // Validate drop_limit bounds
    if (drop_limit !== undefined) {
      if (drop_limit < MIN_DROP_LIMIT || drop_limit > MAX_DROP_LIMIT) {
        return errorResponse(`Drop limit must be between ${MIN_DROP_LIMIT} and ${MAX_DROP_LIMIT}`, 400)
      }
    }

    // Validate counterbid_hours bounds
    if (counterbid_hours !== undefined) {
      if (counterbid_hours < MIN_COUNTERBID_HOURS || counterbid_hours > MAX_COUNTERBID_HOURS) {
        return errorResponse(`Counterbid hours must be between ${MIN_COUNTERBID_HOURS} and ${MAX_COUNTERBID_HOURS}`, 400)
      }
    }

    // Validate draft_counterpick_slots bounds
    if (draft_counterpick_slots !== undefined) {
      if (
        typeof draft_counterpick_slots !== 'number' ||
        !Number.isInteger(draft_counterpick_slots) ||
        draft_counterpick_slots < MIN_COUNTERPICK_SLOTS ||
        draft_counterpick_slots > MAX_DRAFT_COUNTERPICK_SLOTS
      ) {
        return errorResponse(
          `draft_counterpick_slots must be an integer between ${MIN_COUNTERPICK_SLOTS} and ${MAX_DRAFT_COUNTERPICK_SLOTS}`,
          400
        )
      }
    }

    // Validate bidding_counterpick_slots bounds
    if (bidding_counterpick_slots !== undefined) {
      if (
        typeof bidding_counterpick_slots !== 'number' ||
        !Number.isInteger(bidding_counterpick_slots) ||
        bidding_counterpick_slots < MIN_COUNTERPICK_SLOTS ||
        bidding_counterpick_slots > MAX_BIDDING_COUNTERPICK_SLOTS
      ) {
        return errorResponse(
          `bidding_counterpick_slots must be an integer between ${MIN_COUNTERPICK_SLOTS} and ${MAX_BIDDING_COUNTERPICK_SLOTS}`,
          400
        )
      }
    }

    // Validate counterpicks_block_drops is boolean
    if (counterpicks_block_drops !== undefined) {
      if (typeof counterpicks_block_drops !== 'boolean') {
        return errorResponse('counterpicks_block_drops must be a boolean', 400)
      }
    }

    // Build league insert object with optional configuration fields
    const leagueInsert: Record<string, unknown> = {
      name: name.trim(),
      owner_id: user.id,
      invite_only: invite_only || false,
      draft_start_date: draft_start_date || null,
      draft_end_date: draft_end_date || null,
      max_participants: max_participants || 8,
      status: 'setup',
    }

    // Add roster configuration if provided
    if (total_slots !== undefined) leagueInsert.total_slots = total_slots
    if (draft_slots !== undefined) leagueInsert.draft_slots = draft_slots
    if (drop_limit !== undefined) leagueInsert.drop_limit = drop_limit
    if (counterbid_hours !== undefined) leagueInsert.counterbid_hours = counterbid_hours

    // Add counterpick configuration if provided
    if (draft_counterpick_slots !== undefined) leagueInsert.draft_counterpick_slots = draft_counterpick_slots
    if (bidding_counterpick_slots !== undefined) leagueInsert.bidding_counterpick_slots = bidding_counterpick_slots
    if (counterpicks_block_drops !== undefined) leagueInsert.counterpicks_block_drops = counterpicks_block_drops

    // Create the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .insert(leagueInsert)
      .select()
      .single()

    if (leagueError) {
      console.error('Error creating league:', leagueError)
      return errorResponse('Failed to create league', 500)
    }

    // Create league participant for the owner
    const { data: participant, error: participantError } = await supabaseClient
      .from('league_participants')
      .insert({
        league_id: league.id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
        draft_order: 1
      })
      .select()
      .single()

    if (participantError) {
      console.error('Error creating participant:', participantError)
      // League was created but participant failed - still return success with warning
      return jsonResponse({
        league,
        warning: 'League created but failed to add owner as participant'
      }, 201)
    }

    // Create team for the owner
    const defaultTeamName = team_name?.trim() || `${user.email?.split('@')[0]}'s Production Company`
    const { data: team, error: teamError } = await supabaseClient
      .from('teams')
      .insert({
        participant_id: participant.id,
        name: defaultTeamName
      })
      .select()
      .single()

    if (teamError) {
      console.error('Error creating team:', teamError)
      return jsonResponse({
        league,
        participant,
        warning: 'League and participant created but failed to create team'
      }, 201)
    }

    return jsonResponse({ league, participant, team }, 201)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
