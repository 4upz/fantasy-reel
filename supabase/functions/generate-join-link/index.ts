import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  generateJoinCode,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('generate-join-link')

interface GenerateJoinLinkRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate user
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Parse request
    const { league_id }: GenerateJoinLinkRequest = await req.json()

    if (!league_id) {
      return errorResponse('league_id is required', 400)
    }

    if (!isValidUUID(league_id)) {
      return errorResponse('Invalid league_id', 400)
    }

    // Service client for database operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('id, owner_id, status, name')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Check ownership
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can generate join links', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot generate join link after draft has started', 400)
    }

    // Generate new join code and token
    const join_code = generateJoinCode()
    const join_token = crypto.randomUUID()

    // Update league
    const { error: updateError } = await serviceClient
      .from('leagues')
      .update({ join_code, join_token })
      .eq('id', league_id)

    if (updateError) {
      console.error('Error updating league:', updateError)
      return errorResponse('Failed to generate join link', 500)
    }

    // Build join URL
    const appUrl = Deno.env.get('APP_URL') || 'https://fantasyreel.com'
    const join_url = `${appUrl}/join?code=${join_code}`

    return jsonResponse({
      join_code,
      join_token,
      join_url,
      league_id: league.id,
      league_name: league.name,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
