import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  isValidUUID,
  isUpcomingMovie,
  createServiceClient,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor } from '../_shared/discord.ts'
import { activateLeague } from '../_shared/activation.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('draft-pick')

interface MovieData {
  title: string
  overview?: string | null
  poster_url: string | null
  backdrop_url?: string | null
  release_date: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

interface DraftPickRequest {
  league_id: string
  tmdb_id: number
  movie_data?: MovieData
}

interface NextPickInfo {
  round: number
  pick_number: number
  team_id: string
  participant_id: string
  user_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    const serviceClient = createServiceClient()

    const { league_id, tmdb_id, movie_data }: DraftPickRequest = await req.json()

    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.status !== 'drafting') {
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse('Draft has already ended', 400)
    }

    const { data: nextPickData, error: nextPickError } = await serviceClient
      .rpc('get_next_draft_pick', { p_league_id: league_id })

    if (nextPickError) {
      console.error('Error getting next pick:', nextPickError)
      return errorResponse('Failed to determine next pick', 500)
    }

    if (!nextPickData || nextPickData.length === 0) {
      // No more picks - draft should be complete
      return errorResponse('Draft is complete', 400)
    }

    const nextPick: NextPickInfo = nextPickData[0]

    if (nextPick.user_id !== user.id) {
      return errorResponse('It is not your turn to pick', 403)
    }

    let movie: { id: string; title: string; poster_url: string | null; release_date: string | null; status: string }

    const { data: existingMovie, error: movieError } = await serviceClient
      .from('movies')
      .select('id, title, poster_url, release_date, status')
      .eq('tmdb_id', tmdb_id)
      .single()

    if (existingMovie) {
      movie = existingMovie
    } else {
      // Movie doesn't exist, create it
      if (!movie_data) {
        return errorResponse('Movie not found and no movie_data provided', 400)
      }

      const { data: newMovie, error: insertError } = await serviceClient
        .from('movies')
        .insert({
          tmdb_id,
          title: movie_data.title,
          overview: movie_data.overview || null,
          poster_url: movie_data.poster_url,
          backdrop_url: movie_data.backdrop_url || null,
          release_date: movie_data.release_date,
          vote_average: movie_data.vote_average,
          vote_count: 0,
          popularity: movie_data.popularity,
          status: 'upcoming',
          last_synced_at: new Date().toISOString(),
        })
        .select('id, title, poster_url, release_date, status')
        .single()

      if (insertError || !newMovie) {
        // Could be a race condition - try to fetch again
        const { data: retryMovie } = await serviceClient
          .from('movies')
          .select('id, title, poster_url, release_date, status')
          .eq('tmdb_id', tmdb_id)
          .single()

        if (retryMovie) {
          movie = retryMovie
        } else {
          console.error('Error creating movie:', insertError)
          return errorResponse('Failed to create movie record', 500)
        }
      } else {
        movie = newMovie
      }
    }

    const eligibility = isUpcomingMovie(movie.release_date, league.season_year)
    if (!eligibility.valid) {
      return errorResponse(`This movie cannot be drafted: ${eligibility.reason}`, 400)
    }

    // Belt-and-suspenders: also verify status field
    if (movie.status !== 'upcoming') {
      return errorResponse('This movie is not available for drafting', 400)
    }

    const { data: existingPick } = await serviceClient
      .from('draft_picks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie.id)
      .single()

    if (existingPick) {
      return errorResponse('This movie has already been drafted', 400)
    }

    const { data: pick, error: pickError } = await serviceClient
      .from('draft_picks')
      .insert({
        league_id,
        team_id: nextPick.team_id,
        movie_id: movie.id,
        round: nextPick.round,
        pick_number: nextPick.pick_number
      })
      .select()
      .single()

    if (pickError) {
      console.error('Error creating draft pick:', pickError)
      if (pickError.code === '23505') {
        // Unique constraint violation - race condition
        return errorResponse('This pick slot was just taken. Please try again.', 409)
      }
      return errorResponse('Failed to record draft pick', 500)
    }

    const { data: upcomingPickData } = await serviceClient
      .rpc('get_next_draft_pick', { p_league_id: league_id })

    let upcomingPick: NextPickInfo | null = null
    let draftComplete = false

    if (!upcomingPickData || upcomingPickData.length === 0) {
      draftComplete = true

      // Only activate if no counterpick slots configured
      if ((league.draft_counterpick_slots ?? 0) === 0) {
        const result = await activateLeague(serviceClient, league_id, 'drafting')
        if (result.error) {
          console.error('Failed to activate league:', result.error)
        }
      }
    } else {
      upcomingPick = upcomingPickData[0]
    }

    const { data: pickerTeam } = await serviceClient.from('teams').select('name').eq('id', nextPick.team_id).single()
    const pickerTeamName = pickerTeam?.name ?? 'A team'
    const leagueName = league.name ?? 'Fantasy Reel League'

    if (draftComplete) {
      const totalPicks = pick.pick_number
      await sendDiscordNotification(serviceClient, {
        leagueId: league_id,
        category: 'drafts',
        embeds: [{
          author: buildEmbedAuthor(leagueName, league_id),
          title: `${pickerTeamName} selects ${movie.title}`,
          description: `Round ${pick.round}, Pick ${pick.pick_number}`,
          thumbnail: movie.poster_url ? { url: `https://image.tmdb.org/t/p/w92${movie.poster_url}` } : undefined,
          color: DISCORD_COLORS.gold,
          footer: { text: `${totalPicks}/${totalPicks} complete` },
          url: buildLeagueUrl(league_id, '/draft'),
        }],
      })

      const hasCounterpicks = (league.draft_counterpick_slots ?? 0) > 0
      await sendDiscordNotification(serviceClient, {
        leagueId: league_id,
        category: 'drafts',
        embeds: [{
          author: buildEmbedAuthor(leagueName, league_id),
          title: hasCounterpicks ? 'Draft Picks Complete' : 'Draft Complete',
          description: hasCounterpicks
            ? `${totalPicks} selections across ${pick.round} rounds. Counterpick round available.`
            : `${totalPicks} selections across ${pick.round} rounds. The season is underway.`,
          color: hasCounterpicks ? DISCORD_COLORS.yellow : DISCORD_COLORS.green,
          footer: { text: hasCounterpicks ? 'Counterpick round available' : `${leagueName} is now active` },
          url: buildLeagueUrl(league_id, hasCounterpicks ? '/draft' : '/standings'),
        }],
      })
    } else {
      // Regular pick notification
      let nextTeamName = 'TBD'
      let mentionContent: string | undefined
      let pickColor: number = DISCORD_COLORS.gold

      if (upcomingPick) {
        const { data: nextTeam } = await serviceClient.from('teams').select('name').eq('id', upcomingPick.team_id).single()
        nextTeamName = nextTeam?.name ?? 'TBD'

        // Check if next picker has linked Discord account for @mention.
        // The link lives in auth.identities, not profiles -- reachable only
        // via this service-role RPC.
        const { data: discordLinks } = await serviceClient
          .rpc('get_discord_ids_by_user_ids', { p_user_ids: [upcomingPick.user_id] })

        const nextDiscordId = discordLinks?.[0]?.discord_id
        if (nextDiscordId) {
          mentionContent = `<@${nextDiscordId}>, you're on the clock.`
          pickColor = DISCORD_COLORS.yellow
        }
      }

      // Calculate total picks for progress
      const { count: totalParticipants } = await serviceClient
        .from('league_participants')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', league_id)
        .eq('status', 'active')
      const totalPicks = (league.draft_rounds ?? 5) * (totalParticipants ?? 0)

      const fields = upcomingPick ? [{ name: 'Up Next', value: nextTeamName, inline: true }] : []

      await sendDiscordNotification(serviceClient, {
        leagueId: league_id,
        category: 'drafts',
        content: mentionContent,
        embeds: [{
          author: buildEmbedAuthor(leagueName, league_id),
          title: `${pickerTeamName} selects ${movie.title}`,
          description: `Round ${pick.round}, Pick ${pick.pick_number}`,
          thumbnail: movie.poster_url ? { url: `https://image.tmdb.org/t/p/w92${movie.poster_url}` } : undefined,
          fields,
          color: pickColor,
          footer: { text: `${pick.pick_number}/${totalPicks} complete` },
          url: buildLeagueUrl(league_id, '/draft'),
        }],
      })
    }

    return jsonResponse({
      pick: {
        id: pick.id,
        league_id: pick.league_id,
        team_id: pick.team_id,
        movie_id: pick.movie_id,
        round: pick.round,
        pick_number: pick.pick_number,
        picked_at: pick.picked_at
      },
      movie: {
        id: movie.id,
        tmdb_id: tmdb_id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_date: movie.release_date
      },
      next_pick: upcomingPick ? {
        round: upcomingPick.round,
        pick_number: upcomingPick.pick_number,
        team_id: upcomingPick.team_id,
        user_id: upcomingPick.user_id
      } : null,
      draft_complete: draftComplete
    }, 201)

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
