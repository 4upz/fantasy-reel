import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('start-counterpick-round')

interface StartCounterpickRoundRequest {
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
    const { league_id }: StartCounterpickRoundRequest = await req.json()

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
      return errorResponse('Only the league owner can start the counterpick round', 403)
    }

    // Verify league is in drafting status
    if (league.status !== 'drafting') {
      return errorResponse(`Cannot start counterpick round: league is in '${league.status}' status`, 400)
    }

    // Verify counterpick slots are configured
    if (!league.draft_counterpick_slots || league.draft_counterpick_slots <= 0) {
      return errorResponse('League has no counterpick slots configured', 400)
    }

    // Update league status to 'counterpicking'
    const { data: updatedLeague, error: updateError } = await supabaseClient
      .from('leagues')
      .update({ status: 'counterpicking' })
      .eq('id', league_id)
      .eq('status', 'drafting')  // Prevent race condition
      .select()
      .single()

    if (updateError?.code === 'PGRST116' || !updatedLeague) {
      // No rows matched - status was already changed by another request
      return errorResponse('League status has changed, please refresh', 409)
    }

    if (updateError) {
      console.error('Error updating league status:', updateError)
      return errorResponse('Failed to start counterpick round', 500)
    }

    // Get first pick info using the RPC function
    const { data: firstPickData, error: rpcError } = await supabaseClient.rpc('get_next_counterpick_turn', {
      p_league_id: league_id,
    })

    if (rpcError) {
      console.error('Error getting first counterpick turn:', rpcError)
      // Don't fail the whole operation, just return null for first_pick
    }

    return jsonResponse({
      league: updatedLeague,
      message: 'Counterpick round started',
      first_pick: firstPickData?.[0] ?? null,
    }, 200)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
