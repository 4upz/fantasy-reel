import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
} from '../_shared/utils.ts'

interface StartDraftRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase: supabaseClient } = authResult

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

    // Auto-randomize draft order if owner hasn't manually set it
    const { error: randomizeError } = await supabaseClient.rpc('randomize_draft_order_if_needed', {
      p_league_id: league_id,
    })

    if (randomizeError) {
      console.error('Error auto-randomizing draft order:', randomizeError)
      return errorResponse('Failed to prepare draft order', 500)
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
