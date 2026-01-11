import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'

interface UpdateScoresRequest {
  movie_ids?: string[]
  league_id?: string
}

interface OMDbRating {
  Source: string
  Value: string
}

interface OMDbResponse {
  Response: string
  Error?: string
  imdbID?: string
  Title?: string
  Ratings?: OMDbRating[]
}

/**
 * Normalize rating score to 0-100 scale
 */
function normalizeScore(source: string, value: string): number | null {
  try {
    switch (source) {
      case 'Internet Movie Database':
        // "8.5/10" -> 85
        const imdbMatch = value.match(/^([\d.]+)\/10$/)
        if (imdbMatch) {
          return Math.round(parseFloat(imdbMatch[1]) * 10)
        }
        break
      case 'Rotten Tomatoes':
        // "85%" -> 85
        const rtMatch = value.match(/^(\d+)%$/)
        if (rtMatch) {
          return parseInt(rtMatch[1])
        }
        break
      case 'Metacritic':
        // "78/100" -> 78
        const mcMatch = value.match(/^(\d+)\/100$/)
        if (mcMatch) {
          return parseInt(mcMatch[1])
        }
        break
    }
  } catch {
    // Parse error
  }
  return null
}

/**
 * Map OMDb source name to our internal source key
 */
function mapSourceKey(omdbSource: string): string | null {
  switch (omdbSource) {
    case 'Internet Movie Database':
      return 'imdb'
    case 'Rotten Tomatoes':
      return 'rotten_tomatoes'
    case 'Metacritic':
      return 'metacritic'
    default:
      return null
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const omdbApiKey = Deno.env.get('OMDB_API_KEY')
    if (!omdbApiKey) {
      console.error('OMDB_API_KEY not configured')
      return errorResponse('Score update service not configured', 503)
    }

    // Create service role client
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    let params: UpdateScoresRequest = {}
    try {
      if (req.method === 'POST') {
        const body = await req.text()
        if (body) {
          params = JSON.parse(body)
        }
      }
    } catch {
      // Ignore parse errors
    }

    let moviesToUpdate: Array<{ id: string; imdb_id: string | null; title: string }> = []

    if (params.movie_ids && params.movie_ids.length > 0) {
      // Update specific movies
      const validIds = params.movie_ids.filter(id => isValidUUID(id))
      if (validIds.length === 0) {
        return errorResponse('No valid movie_ids provided', 400)
      }

      const { data, error } = await serviceClient
        .from('movies')
        .select('id, imdb_id, title')
        .in('id', validIds)

      if (error) {
        console.error('Error fetching movies:', error)
        return errorResponse('Failed to fetch movies', 500)
      }

      moviesToUpdate = data || []
    } else if (params.league_id) {
      // Update movies drafted in a specific league
      if (!isValidUUID(params.league_id)) {
        return errorResponse('Invalid league_id', 400)
      }

      const { data, error } = await serviceClient
        .from('draft_picks')
        .select(`
          movie_id,
          movies!inner(id, imdb_id, title, status)
        `)
        .eq('league_id', params.league_id)

      if (error) {
        console.error('Error fetching draft picks:', error)
        return errorResponse('Failed to fetch drafted movies', 500)
      }

      moviesToUpdate = data?.map(d => ({
        id: d.movies.id,
        imdb_id: d.movies.imdb_id,
        title: d.movies.title
      })) || []
    } else {
      // Default: update all released movies without recent scores
      const oneWeekAgo = new Date()
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

      const { data, error } = await serviceClient
        .from('movies')
        .select('id, imdb_id, title')
        .eq('status', 'released')
        .or(`last_synced_at.is.null,last_synced_at.lt.${oneWeekAgo.toISOString()}`)
        .limit(50) // Limit to avoid hitting OMDb rate limits

      if (error) {
        console.error('Error fetching movies:', error)
        return errorResponse('Failed to fetch movies', 500)
      }

      moviesToUpdate = data || []
    }

    if (moviesToUpdate.length === 0) {
      return jsonResponse({
        movies_fetched: 0,
        reviews_updated: 0,
        teams_recalculated: 0,
        errors: []
      })
    }

    const results = {
      movies_fetched: 0,
      reviews_updated: 0,
      teams_recalculated: 0,
      errors: [] as Array<{ movie_id: string; title: string; error: string }>
    }

    // Process each movie
    for (const movie of moviesToUpdate) {
      if (!movie.imdb_id) {
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'No IMDB ID available'
        })
        continue
      }

      try {
        // Fetch from OMDb
        const omdbUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${movie.imdb_id}`
        const omdbResponse = await fetch(omdbUrl)

        if (!omdbResponse.ok) {
          if (omdbResponse.status === 401) {
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: 'OMDb API authentication failed'
            })
            continue
          }
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: `OMDb API error: ${omdbResponse.status}`
          })
          continue
        }

        const omdbData: OMDbResponse = await omdbResponse.json()

        if (omdbData.Response === 'False') {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: omdbData.Error || 'Movie not found on OMDb'
          })
          continue
        }

        results.movies_fetched++

        // Process ratings
        if (omdbData.Ratings && omdbData.Ratings.length > 0) {
          for (const rating of omdbData.Ratings) {
            const sourceKey = mapSourceKey(rating.Source)
            if (!sourceKey) continue

            const normalizedScore = normalizeScore(rating.Source, rating.Value)
            if (normalizedScore === null) continue

            // Upsert review
            const { error: reviewError } = await serviceClient
              .from('reviews')
              .upsert({
                movie_id: movie.id,
                source: sourceKey,
                score: normalizedScore,
                raw_score: rating.Value,
                fetched_at: new Date().toISOString()
              }, {
                onConflict: 'movie_id,source'
              })

            if (reviewError) {
              console.error(`Error upserting review for ${movie.title}:`, reviewError)
            } else {
              results.reviews_updated++
            }
          }
        }

        // Update movie's last_synced_at
        await serviceClient
          .from('movies')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', movie.id)

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        console.error(`Error processing movie ${movie.title}:`, error)
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'Failed to fetch or process ratings'
        })
      }
    }

    // Recalculate team scores for affected leagues
    if (params.league_id) {
      // Get all teams in the league
      const { data: participants } = await serviceClient
        .from('league_participants')
        .select('id')
        .eq('league_id', params.league_id)
        .eq('status', 'active')

      if (participants) {
        const { data: teams } = await serviceClient
          .from('teams')
          .select('id')
          .in('participant_id', participants.map(p => p.id))

        if (teams) {
          for (const team of teams) {
            // Calculate score using the database function
            const { data: scoreData } = await serviceClient
              .rpc('calculate_team_score', { p_team_id: team.id })

            if (scoreData && scoreData.length > 0) {
              const score = scoreData[0]
              await serviceClient
                .from('team_scores')
                .upsert({
                  team_id: team.id,
                  total_points: score.total_points || 0,
                  movies_scored: score.movies_scored || 0,
                  movies_pending: score.movies_pending || 0,
                  average_score: score.average_score || 0,
                  last_calculated_at: new Date().toISOString()
                }, { onConflict: 'team_id' })

              results.teams_recalculated++
            }
          }
        }
      }
    }

    return jsonResponse(results)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
