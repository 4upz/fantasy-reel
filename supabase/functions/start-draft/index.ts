import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface StartDraftRequest {
  league_id: string
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
    const { league_id }: StartDraftRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Verify user is the league owner
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can start the draft', 403)
    }

    // Verify league is in setup status
    if (league.status !== 'setup') {
      return errorResponse(`Cannot start draft: league is already in '${league.status}' status`, 400)
    }

    // Count participants
    const { count: participantCount, error: countError } = await supabaseClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)
      .eq('status', 'active')

    if (countError) {
      console.error('Error counting participants:', countError)
      return errorResponse('Failed to check participants', 500)
    }

    if (!participantCount || participantCount < 2) {
      return errorResponse('Need at least 2 participants to start the draft', 400)
    }

    // Update league status to 'drafting'
    const { data: updatedLeague, error: updateError } = await supabaseClient
      .from('leagues')
      .update({ status: 'drafting' })
      .eq('id', league_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating league status:', updateError)
      return errorResponse('Failed to start draft', 500)
    }

    return jsonResponse({
      league: updatedLeague,
      message: 'Draft started successfully',
      participant_count: participantCount,
    }, 200)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
