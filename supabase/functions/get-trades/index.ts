import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createServiceClient } from '../_shared/trade-validation.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('get-trades')

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

/** Holdings named by more than one open offer in this league, keyed by source_id. */
type ContestedMap = Map<string, number>

async function getContestedSourceIds(
  supabase: ReturnType<typeof createServiceClient>,
  leagueId: string
): Promise<ContestedMap> {
  const { data, error } = await supabase.rpc('get_contested_source_ids', {
    p_league_id: leagueId,
  })

  if (error) {
    // A missing contest annotation only costs the UI its "Contested" badge, so
    // degrade to "nothing contested" rather than failing the whole trade list.
    log.warn('Failed to resolve contested source ids', { league_id: leagueId, error: error.message })
    return new Map()
  }

  return new Map(
    (data ?? []).map((row: { source_id: string; trade_count: number }) => [
      row.source_id,
      Number(row.trade_count),
    ])
  )
}

/**
 * Titles for every movie these offers are anchored to, in one query.
 *
 * Keyed by movie id rather than per-offer so a league whose offers all wait on
 * the same release costs a single lookup.
 */
async function getAnchorTitles(
  supabase: ReturnType<typeof createServiceClient>,
  trades: Array<{ expiry_anchor_movie_id?: string | null }>
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      trades
        .map((trade) => trade.expiry_anchor_movie_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]

  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('movies').select('id, title').in('id', ids)

  if (error) {
    // Only costs the card its movie name, so degrade rather than fail the list.
    log.warn('Failed to resolve expiry anchor titles', { error: error.message })
    return new Map()
  }

  return new Map((data ?? []).map((movie: { id: string; title: string }) => [movie.id, movie.title]))
}

interface TradeItemsShape {
  movies?: Array<{ source_id?: string }>
}

/** The source_ids in this offer that other open offers also name. */
function contestedSourceIdsFor(
  trade: { initiator_items?: TradeItemsShape; recipient_items?: TradeItemsShape },
  contested: ContestedMap
): string[] {
  if (contested.size === 0) return []

  const ids = [
    ...(trade.initiator_items?.movies ?? []),
    ...(trade.recipient_items?.movies ?? []),
  ]
    .map((movie) => movie?.source_id)
    .filter((id): id is string => id !== undefined && contested.has(id))

  return [...new Set(ids)]
}

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

    // The movie a release-anchored offer waits on, resolved here from the live
    // movies table. The client used to derive this from the items snapshot,
    // which could name the wrong film once release dates moved -- the server
    // knows which movie it picked, so it says so.
    const anchorTitles = await getAnchorTitles(serviceClient, trades ?? [])

    // Annotate each offer with which of ITS OWN movies are also named by another
    // open offer, so the UI can flag a contested deal. get_contested_source_ids
    // returns counts only -- never which teams or offers are competing -- so
    // this cannot be used to infer the contents of someone else's trade.
    const contested = await getContestedSourceIds(serviceClient, league_id)

    const tradesWithContest = (trades ?? []).map((trade) => ({
      ...trade,
      contested_source_ids: contestedSourceIdsFor(trade, contested),
      anchor_movie_title: trade.expiry_anchor_movie_id
        ? anchorTitles.get(trade.expiry_anchor_movie_id) ?? null
        : null,
    }))

    return jsonResponse({
      trades: tradesWithContest,
      pagination: {
        total: totalCount ?? 0,
        limit,
        offset,
        has_more: offset + limit < (totalCount ?? 0),
      },
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
