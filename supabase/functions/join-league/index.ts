import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface JoinLeagueRequest {
  league_id?: string
  invitation_token?: string
  team_name?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create user-authenticated client for auth validation
    const userClient = createClient(
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
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Create service role client for database operations (bypasses RLS)
    // This is needed because users joining via invitation aren't participants yet,
    // so RLS would block their access to the league
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    const { league_id, invitation_token, team_name }: JoinLeagueRequest = await req.json()

    // Validate input - need either league_id or invitation_token
    if (!league_id && !invitation_token) {
      return errorResponse('Either league_id or invitation_token is required', 400)
    }

    let targetLeagueId: string

    // Handle invitation token flow
    if (invitation_token) {
      if (!isValidUUID(invitation_token)) {
        return errorResponse('Invalid invitation token', 400)
      }

      // Look up invitation
      const { data: invitation, error: inviteError } = await serviceClient
        .from('invitations')
        .select('*')
        .eq('token', invitation_token)
        .single()

      if (inviteError || !invitation) {
        return errorResponse('Invalid or expired invitation', 404)
      }

      // Validate invitation status
      if (invitation.status !== 'pending') {
        return errorResponse(`Invitation has already been ${invitation.status}`, 400)
      }

      // Check expiration
      if (new Date(invitation.expires_at) < new Date()) {
        return errorResponse('Invitation has expired', 400)
      }

      // Verify email matches (case-insensitive)
      if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
        return errorResponse('This invitation was sent to a different email address', 403)
      }

      targetLeagueId = invitation.league_id

      // Update invitation status to accepted
      const { error: updateInviteError } = await serviceClient
        .from('invitations')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString()
        })
        .eq('id', invitation.id)

      if (updateInviteError) {
        console.error('Error updating invitation:', updateInviteError)
      }
    } else {
      // Direct join flow - validate league_id
      if (!isValidUUID(league_id!)) {
        return errorResponse('Invalid league_id', 400)
      }
      targetLeagueId = league_id!
    }

    // Fetch the league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', targetLeagueId)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // For direct join (not via invitation), check if league is open
    if (!invitation_token && league.invite_only) {
      return errorResponse('This league is invite-only', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot join league - draft has already started', 400)
    }

    // Check if user is already a participant
    const { data: existingParticipant } = await serviceClient
      .from('league_participants')
      .select('id')
      .eq('league_id', targetLeagueId)
      .eq('user_id', user.id)
      .single()

    if (existingParticipant) {
      return errorResponse('You are already a member of this league', 400)
    }

    // Check if league is full
    const { count: participantCount } = await serviceClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', targetLeagueId)
      .eq('status', 'active')

    if (participantCount !== null && participantCount >= league.max_participants) {
      return errorResponse('League is full', 400)
    }

    // Calculate draft order (next available position)
    const draftOrder = (participantCount || 0) + 1

    // Create participant
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .insert({
        league_id: targetLeagueId,
        user_id: user.id,
        role: 'member',
        status: 'active',
        draft_order: draftOrder
      })
      .select()
      .single()

    if (participantError) {
      console.error('Error creating participant:', participantError)
      return errorResponse('Failed to join league', 500)
    }

    // Create team
    const defaultTeamName = team_name?.trim() || `${user.email?.split('@')[0]}'s Production Company`
    const { data: team, error: teamError } = await serviceClient
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
        participant,
        league: { id: league.id, name: league.name },
        warning: 'Joined league but failed to create team'
      }, 201)
    }

    return jsonResponse({
      participant,
      team,
      league: { id: league.id, name: league.name }
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
