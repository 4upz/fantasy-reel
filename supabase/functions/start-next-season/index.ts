/**
 * Start Next Season Edge Function
 *
 * Rolls a finished season over into the next one: same league (series), same
 * settings, same people, empty rosters. Commissioner-initiated only -- a
 * completed season nobody rolls over just stays completed.
 *
 * Request:  { league_id: string }   // the season that has finished
 * Response: { league_id: string, season_year: number }  // the season just opened
 */

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
import {
  sendDiscordNotification,
  DISCORD_COLORS,
  buildLeagueUrl,
  buildEmbedAuthor,
} from '../_shared/discord.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('start-next-season')

interface StartNextSeasonRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const serviceClient = createServiceClient()

    const { league_id }: StartNextSeasonRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    const { data: source, error: sourceError } = await serviceClient
      .from('leagues')
      .select('id, name, owner_id, status, series_id, season_year')
      .eq('id', league_id)
      .single()

    if (sourceError || !source) {
      return errorResponse('League not found', 404)
    }

    if (source.owner_id !== user.id) {
      return errorResponse('Only the league commissioner can start the next season', 403)
    }

    // Checked here as well as inside the RPC. The RPC's check is the one that
    // holds under concurrency (it runs under the row lock); this one exists to
    // give a readable 400 instead of a raised Postgres exception surfacing as
    // a 500.
    if (source.status !== 'completed') {
      return errorResponse(
        'The current season has to finish before the next one can start',
        400
      )
    }

    const seasonYear = source.season_year + 1

    const { data: existing } = await serviceClient
      .from('leagues')
      .select('id')
      .eq('series_id', source.series_id)
      .eq('season_year', seasonYear)
      .maybeSingle()

    if (existing) {
      return errorResponse(`The ${seasonYear} season has already been started`, 409, {
        league_id: existing.id,
        season_year: seasonYear,
      })
    }

    const { data: newLeagueId, error: rpcError } = await serviceClient.rpc('start_next_season', {
      p_league_id: league_id,
      p_season_year: seasonYear,
    })

    if (rpcError || !newLeagueId) {
      log.error('Failed to start next season', {
        league_id,
        season_year: seasonYear,
        error: serializeError(rpcError),
      })
      return errorResponse('Failed to start the next season', 500)
    }

    log.info('Started next season', {
      league_id: newLeagueId,
      previous_league_id: league_id,
      season_year: seasonYear,
    })

    // ------------------------------------------------------------------
    // Tell everyone. Past this point the season exists and the request has
    // succeeded: a failed notification must not undo it, so both sends are
    // settled independently and only logged.
    // ------------------------------------------------------------------
    const { data: participants, error: participantsError } = await serviceClient
      .from('league_participants')
      .select('user_id')
      .eq('league_id', newLeagueId)
      .eq('status', 'active')

    if (participantsError) {
      log.error('Failed to read participants for season_started notifications', {
        league_id: newLeagueId,
        error: serializeError(participantsError),
      })
    }

    const notifications = (participants ?? []).map((participant) => ({
      user_id: participant.user_id,
      league_id: newLeagueId,
      type: 'season_started',
      title: `The ${seasonYear} season is open`,
      body: `${source.name} is back. Set your roster up and get ready to draft.`,
      data: {
        league_id: newLeagueId,
        previous_league_id: league_id,
        series_id: source.series_id,
        season_year: seasonYear,
      },
    }))

    // Both announcements settle independently, and a PostgREST `{ error }` is
    // turned into a rejection so there is one failure shape to log rather than
    // two.
    const results = await Promise.allSettled([
      notifications.length > 0
        ? serviceClient
            .from('notifications')
            .insert(notifications)
            .then(({ error }: { error: unknown }) => {
              if (error) throw error
            })
        : Promise.resolve(),
      // 'general': a rollover is rare, owner-initiated, and interesting to
      // everyone in the channel, so it is not worth a dedicated toggle.
      sendDiscordNotification(serviceClient, {
        leagueId: newLeagueId,
        category: 'general',
        embeds: [{
          author: buildEmbedAuthor(source.name, newLeagueId),
          title: `🎬 The ${seasonYear} season is open`,
          description: `**${source.name}** has rolled over. Same league, fresh slate — rosters are empty and the draft is yet to be set.`,
          color: DISCORD_COLORS.gold,
          footer: { text: `${seasonYear} Season` },
          url: buildLeagueUrl(newLeagueId),
        }],
      }),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        log.error('Season-started notification failed', {
          league_id: newLeagueId,
          error: serializeError(result.reason),
        })
      }
    }

    return jsonResponse({ league_id: newLeagueId, season_year: seasonYear }, 201)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
