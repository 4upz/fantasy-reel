import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import { createServiceClient } from '../_shared/trade-validation.ts'

interface GetTradesParams {
  league_id: string
  team_id?: string
  status?: string
  limit?: number
  offset?: number
}

const VALID_STATUSES = [
  'proposed',
  'countered',
  'accepted',
  'review',
  'completed',
  'rejected',
  'cancelled',
  'vetoed',
  'expired',
]

function parseParams(req: Request): GetTradesParams {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    return {
      league_id: url.searchParams.get('league_id') ?? '',
      team_id: url.searchParams.get('team_id') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
      offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
    }
  }
  return {} as GetTradesParams
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const params = req.method === 'GET' ? parseParams(req) : await req.json()
    const { league_id, team_id, status, limit = 50, offset = 0 } = params

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    // Verify user is a member of this league
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (participantError || !participant) {
      return errorResponse('You are not a member of this league', 403)
    }

    let query = serviceClient
      .from('trade_offers')
      .select(`
        *,
        initiator_team:teams!trade_offers_initiator_team_id_fkey(id, name, avatar_url),
        recipient_team:teams!trade_offers_recipient_team_id_fkey(id, name, avatar_url)
      `)
      .eq('league_id', league_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (team_id && isValidUUID(team_id)) {
      query = query.or(`initiator_team_id.eq.${team_id},recipient_team_id.eq.${team_id}`)
    }

    if (status && VALID_STATUSES.includes(status)) {
      query = query.eq('status', status)
    }

    const { data: trades, error: tradesError } = await query

    if (tradesError) {
      console.error('Failed to fetch trades:', tradesError)
      return errorResponse('Failed to fetch trades', 500)
    }

    const { count: totalCount } = await serviceClient
      .from('trade_offers')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', league_id)

    return jsonResponse({
      trades: trades ?? [],
      pagination: {
        total: totalCount ?? 0,
        limit,
        offset,
        has_more: offset + limit < (totalCount ?? 0),
      },
    })
  } catch (error) {
    console.error('Error fetching trades:', error)
    return errorResponse('Internal server error', 500)
  }
})
