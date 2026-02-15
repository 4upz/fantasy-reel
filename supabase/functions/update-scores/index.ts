import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID } from '../_shared/utils.ts'
import { normalizeRating, fetchImdbId } from '../_shared/scoring.ts'
import type { OMDbResponse, MovieRecord } from '../_shared/scoring.ts'

interface UpdateScoresRequest {
  movie_ids?: string[]
  league_id?: string
}

function parseRequestBody(body: string): UpdateScoresRequest {
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Verify caller is authorized (cron secret OR service role key)
    const cronSecret = Deno.env.get('CRON_SECRET')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const isAuthorizedByCron = cronSecret && req.headers.get('X-Cron-Secret') === cronSecret
    const isAuthorizedByServiceRole =
      serviceRoleKey && req.headers.get('Authorization') === `Bearer ${serviceRoleKey}`

    if (!isAuthorizedByCron && !isAuthorizedByServiceRole) {
      return errorResponse('Forbidden', 403)
    }

    const omdbApiKey = Deno.env.get('OMDB_API_KEY')
    if (!omdbApiKey) {
      console.error('OMDB_API_KEY not configured')
      return errorResponse('Score update service not configured', 503)
    }

    const tmdbApiKey = Deno.env.get('TMDB_API_KEY')
    if (!tmdbApiKey) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('Score update service not configured', 503)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Score update service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)

    const params = req.method === 'POST'
      ? parseRequestBody(await req.text())
      : {}

    let moviesToUpdate: MovieRecord[] = []

    if (params.movie_ids && params.movie_ids.length > 0) {
      // Update specific movies
      const validIds = params.movie_ids.filter(id => isValidUUID(id))
      if (validIds.length === 0) {
        return errorResponse('No valid movie_ids provided', 400)
      }

      const { data, error } = await serviceClient
        .from('movies')
        .select('id, tmdb_id, imdb_id, title')
        .in('id', validIds)

      if (error) {
        console.error('Error fetching movies:', error)
        return errorResponse('Failed to fetch movies', 500)
      }

      moviesToUpdate = (data as MovieRecord[]) || []
    } else if (params.league_id) {
      // Update movies drafted in a specific league
      if (!isValidUUID(params.league_id)) {
        return errorResponse('Invalid league_id', 400)
      }

      const { data, error } = await serviceClient
        .from('draft_picks')
        .select(`
          movie_id,
          movies!inner(id, tmdb_id, imdb_id, title, status)
        `)
        .eq('league_id', params.league_id)

      if (error) {
        console.error('Error fetching draft picks:', error)
        return errorResponse('Failed to fetch drafted movies', 500)
      }

      // Supabase types the !inner join as an array, but it always returns a single object
      moviesToUpdate = data?.map((d: { movies: MovieRecord | MovieRecord[] }) => {
        const m = Array.isArray(d.movies) ? d.movies[0] : d.movies
        return { id: m.id, tmdb_id: m.tmdb_id, imdb_id: m.imdb_id, title: m.title }
      }) || []
    } else {
      // Default: find released drafted movies needing score updates
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const { data, error } = await serviceClient
        .from('movies')
        .select('id, tmdb_id, imdb_id, title')
        .lte('release_date', new Date().toISOString().split('T')[0])
        .neq('status', 'canceled')
        .or(`scores_updated_at.is.null,scores_updated_at.lt.${oneDayAgo.toISOString()}`)
        .limit(30)

      if (error) {
        console.error('Error fetching movies:', error)
        return errorResponse('Failed to fetch movies', 500)
      }

      moviesToUpdate = (data as MovieRecord[]) || []
    }

    if (moviesToUpdate.length === 0) {
      return jsonResponse({
        movies_fetched: 0,
        scores_updated: 0,
        errors: []
      })
    }

    const results = {
      movies_fetched: 0,
      scores_updated: 0,
      errors: [] as Array<{ movie_id: string; title: string; error: string }>
    }

    // Process each movie
    for (const movie of moviesToUpdate) {
      // Resolve IMDB ID if missing
      let imdbId = movie.imdb_id
      if (!imdbId && movie.tmdb_id) {
        imdbId = await fetchImdbId(movie.tmdb_id, tmdbApiKey)
        if (imdbId) {
          await serviceClient.from('movies').update({ imdb_id: imdbId }).eq('id', movie.id)
        }
      }

      if (!imdbId) {
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'No IMDB ID available'
        })
        continue
      }

      try {
        // Fetch from OMDb (HTTPS)
        const omdbUrl = `https://www.omdbapi.com/?apikey=${omdbApiKey}&i=${imdbId}`
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

        // Process and store ratings
        let ratingsStored = 0
        if (omdbData.Ratings && omdbData.Ratings.length > 0) {
          for (const rating of omdbData.Ratings) {
            const { source, score, raw } = normalizeRating(rating)
            if (!source || score === null) continue

            const { error: reviewError } = await serviceClient
              .from('reviews')
              .upsert({
                movie_id: movie.id,
                source,
                score,
                raw_score: raw,
                fetched_at: new Date().toISOString()
              }, {
                onConflict: 'movie_id,source'
              })

            if (reviewError) {
              console.error(`Error upserting review for ${movie.title}:`, reviewError)
            } else {
              ratingsStored++
            }
          }
        }

        // Calculate fantasy points via PostgreSQL function
        // This also cascades to recalculate_teams_for_movie() and updates scores_updated_at
        if (ratingsStored > 0) {
          const { data: fantasyPts, error: calcError } = await serviceClient.rpc(
            'calculate_movie_score',
            { p_movie_id: movie.id }
          )

          if (calcError) {
            console.error(`Score calculation failed for ${movie.title}:`, calcError)
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: 'Score calculation failed'
            })
          } else {
            console.log(`Calculated score for ${movie.title}: ${fantasyPts}`)
            results.scores_updated++
          }
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 50))

      } catch (error) {
        console.error(`Error processing movie ${movie.title}:`, error)
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'Failed to fetch or process ratings'
        })
      }
    }

    return jsonResponse(results)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
