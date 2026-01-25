import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

interface CreateLeagueRequest {
  name: string
  invite_only?: boolean
  draft_start_date?: string
  draft_end_date?: string
  max_participants?: number
  team_name?: string
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
      team_name
    }: CreateLeagueRequest = await req.json()

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return errorResponse('League name is required', 400)
    }

    // Create the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .insert({
        name: name.trim(),
        owner_id: user.id,
        invite_only: invite_only || false,
        draft_start_date: draft_start_date || null,
        draft_end_date: draft_end_date || null,
        max_participants: max_participants || 8,
        status: 'setup'
      })
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
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
