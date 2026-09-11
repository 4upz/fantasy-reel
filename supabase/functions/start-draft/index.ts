import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  createServiceClient,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor } from '../_shared/discord.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('start-draft')

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

    // Ownership, order preparation, and the phase change share one database lock.
    const { data: started, error: startError } = await supabaseClient.rpc('start_draft', {
      p_league_id: league_id,
    })

    if (startError) {
      if (['PT400', 'PT403', 'PT404', 'PT409'].includes(startError.code)) {
        return errorResponse(startError.message, Number(startError.code.slice(2)))
      }
      log.error('Failed to start draft', { league_id, error: serializeError(startError) })
      return errorResponse('Failed to start draft', 500)
    }

    const { league: updatedLeague, participant_count: participantCount } = started

    // Discord notification: draft started
    const serviceClient = createServiceClient()
    const { data: firstPickData } = await supabaseClient.rpc('get_next_draft_pick', { p_league_id: league_id })
    const firstPickTeamId = firstPickData?.[0]?.team_id
    let firstTeamName = 'TBD'
    if (firstPickTeamId) {
      const { data: firstTeam } = await supabaseClient.from('teams').select('name').eq('id', firstPickTeamId).single()
      firstTeamName = firstTeam?.name ?? 'TBD'
    }
    const leagueName = updatedLeague.name ?? 'Fantasy Reel League'

    await sendDiscordNotification(serviceClient, {
      leagueId: league_id,
      category: 'drafts',
      embeds: [{
        author: buildEmbedAuthor(leagueName, league_id),
        title: 'The Draft Is Open',
        description: `${participantCount} teams on the clock. First pick: ${firstTeamName}.`,
        color: DISCORD_COLORS.gold,
        footer: { text: `Round 1 of ${updatedLeague.draft_slots}` },
        url: buildLeagueUrl(league_id, '/draft'),
      }],
    })

    return jsonResponse({
      league: updatedLeague,
      message: 'Draft started successfully',
      participant_count: participantCount,
    }, 200)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
