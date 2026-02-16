import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
} from '../_shared/utils.ts'

type Action = 'update_info' | 'update_draft_config' | 'update_bidding_config' | 'update_counterpick_config' | 'randomize_draft_order' | 'reorder_participants' | 'kick_participant' | 'delete_league'

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

interface UpdateCounterpickConfigRequest {
  action: 'update_counterpick_config'
  league_id: string
  draft_counterpick_slots?: number
  bidding_counterpick_slots?: number
  counterpicks_block_drops?: boolean
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
  | RandomizeDraftOrderRequest
  | ReorderParticipantsRequest
  | KickParticipantRequest
  | DeleteLeagueRequest

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

      case 'randomize_draft_order':
        return await handleRandomizeDraftOrder(supabase, league)

      case 'reorder_participants':
        return await handleReorderParticipants(supabase, league, body as ReorderParticipantsRequest)

      case 'kick_participant':
        return await handleKickParticipant(supabase, league, user.id, body as KickParticipantRequest)

      case 'delete_league':
        return await handleDeleteLeague(supabase, league)

      default:
        return errorResponse('Invalid action', 400)
    }
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})

async function handleUpdateInfo(
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
  league: { id: string },
  body: UpdateInfoRequest
): Promise<Response> {
  const updates: Record<string, unknown> = {}

  // Validate and set name
  if (body.name !== undefined) {
    const trimmedName = body.name.trim()
    if (trimmedName.length === 0) {
      return errorResponse('League name cannot be empty', 400)
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return errorResponse(`League name cannot exceed ${MAX_NAME_LENGTH} characters`, 400)
    }
    updates.name = trimmedName
  }

  // Set invite_only
  if (body.invite_only !== undefined) {
    updates.invite_only = body.invite_only
  }

  // Nothing to update
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

  return jsonResponse({ league: updatedLeague, message: 'League updated successfully' })
}

async function handleUpdateDraftConfig(
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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

async function handleKickParticipant(
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
  supabase: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
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
