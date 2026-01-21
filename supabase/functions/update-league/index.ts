import { corsHeaders } from '../_shared/cors.ts'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
} from '../_shared/utils.ts'

type Action = 'update_info' | 'update_draft_config' | 'update_bidding_config' | 'kick_participant' | 'delete_league'

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

type UpdateLeagueRequest =
  | UpdateInfoRequest
  | UpdateDraftConfigRequest
  | UpdateBiddingConfigRequest
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
