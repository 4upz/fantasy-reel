import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, isUpcomingMovie } from '../_shared/utils.ts'
import { sendDiscordNotification, DISCORD_COLORS, buildLeagueUrl, buildEmbedAuthor } from '../_shared/discord.ts'

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
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create user-authenticated client for auth validation
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Validate the user
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Create service role client for atomic operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    const { league_id, tmdb_id, movie_data }: DraftPickRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!tmdb_id || typeof tmdb_id !== 'number' || tmdb_id <= 0) {
      return errorResponse('Valid tmdb_id is required', 400)
    }

    // Fetch the league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Validate league status
    if (league.status !== 'drafting') {
      if (league.status === 'setup') {
        return errorResponse('Draft has not started yet', 400)
      }
      return errorResponse('Draft has already ended', 400)
    }

    // Get next pick info using the database function
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

    // Verify it's the user's turn
    if (nextPick.user_id !== user.id) {
      return errorResponse('It is not your turn to pick', 403)
    }

    // Find or create movie by tmdb_id
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

    // Validate movie is eligible for drafting (upcoming, current year or later)
    const eligibility = isUpcomingMovie(movie.release_date)
    if (!eligibility.valid) {
      return errorResponse(`This movie cannot be drafted: ${eligibility.reason}`, 400)
    }

    // Check movie status (belt and suspenders with the date check above)
    if (movie.status !== 'upcoming') {
      return errorResponse('This movie is not available for drafting', 400)
    }

    // Check if movie already drafted in this league
    const { data: existingPick } = await serviceClient
      .from('draft_picks')
      .select('id')
      .eq('league_id', league_id)
      .eq('movie_id', movie.id)
      .single()

    if (existingPick) {
      return errorResponse('This movie has already been drafted', 400)
    }

    // Insert the draft pick
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

    // Get the next pick (for the response)
    const { data: upcomingPickData } = await serviceClient
      .rpc('get_next_draft_pick', { p_league_id: league_id })

    let upcomingPick: NextPickInfo | null = null
    let draftComplete = false

    if (!upcomingPickData || upcomingPickData.length === 0) {
      draftComplete = true

      // Update league status to 'active'
      const { error: statusError } = await serviceClient
        .from('leagues')
        .update({ status: 'active' })
        .eq('id', league_id)

      if (statusError) {
        console.error('Failed to update league status:', statusError)
        // Continue anyway - draft pick was recorded successfully
      }

      // Initialize team budgets for bidding
      const { error: budgetError } = await serviceClient.rpc('initialize_team_budgets', { p_league_id: league_id })
      if (budgetError) {
        console.error('Failed to initialize team budgets:', budgetError)
        // Log but don't fail - can be manually fixed if needed
      }

      // Create team_scores for all teams in the league
      // First, get participant IDs for this league
      const { data: participants } = await serviceClient
        .from('league_participants')
        .select('id')
        .eq('league_id', league_id)

      const participantIds = participants?.map(p => p.id) || []

      const { data: teams } = participantIds.length > 0
        ? await serviceClient
            .from('teams')
            .select('id, participant_id')
            .in('participant_id', participantIds)
        : { data: [] }

      if (teams && teams.length > 0) {
        // Use bulk upsert instead of loop for better performance
        const teamScores = teams.map(team => ({
          team_id: team.id,
          total_points: 0,
          draft_points: 0,
          counterpick_points: 0,
          movies_scored: 0,
          movies_pending: 0,
          counterpicks_made: 0,
          counterpicks_scored: 0,
        }))

        const { error: scoresError } = await serviceClient
          .from('team_scores')
          .upsert(teamScores, { onConflict: 'team_id' })

        if (scoresError) {
          console.error('Failed to initialize team scores:', scoresError)
          // Log but don't fail - can be manually fixed if needed
        }
      }
    } else {
      upcomingPick = upcomingPickData[0]
    }

    // Discord notifications
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

      await sendDiscordNotification(serviceClient, {
        leagueId: league_id,
        category: 'drafts',
        embeds: [{
          author: buildEmbedAuthor(leagueName, league_id),
          title: 'Draft Complete',
          description: `${totalPicks} selections across ${pick.round} rounds. The season is underway.`,
          color: DISCORD_COLORS.green,
          footer: { text: `${leagueName} is now active` },
          url: buildLeagueUrl(league_id, '/standings'),
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

        // Check if next picker has linked Discord account for @mention
        const { data: nextProfile } = await serviceClient
          .from('profiles')
          .select('discord_id')
          .eq('user_id', upcomingPick.user_id)
          .single()

        if (nextProfile?.discord_id) {
          mentionContent = `<@${nextProfile.discord_id}>, you're on the clock.`
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
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
