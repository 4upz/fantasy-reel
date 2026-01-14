/**
 * Process Movie Scores Edge Function
 *
 * LAYER 3 of the three-layer scoring architecture.
 * This function is intentionally lightweight - it only:
 *   1. Fetches IMDB IDs from TMDB (if missing)
 *   2. Fetches scores from OMDB API
 *   3. Stores raw scores in the reviews table
 *   4. Calls PostgreSQL function for weighted calculation
 *   5. Acknowledges processed messages
 *
 * Heavy calculation is done in PostgreSQL (calculate_movie_score function).
 *
 * Invoked by: pg_cron via process_score_queue() SQL function
 * Batch size: 5 movies per invocation (configurable in SQL)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse } from '../_shared/utils.ts'

interface ProcessRequest {
  movie_ids: string[]
  msg_ids: number[]
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

interface TMDbExternalIds {
  imdb_id?: string
  facebook_id?: string
  instagram_id?: string
  twitter_id?: string
}

interface MovieRecord {
  id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
}

interface RatingParser {
  source: string
  pattern: RegExp
  normalize: (match: RegExpMatchArray) => number
}

const RATING_PARSERS: Record<string, RatingParser> = {
  'Internet Movie Database': {
    source: 'imdb',
    pattern: /^([\d.]+)\/10$/,
    normalize: (match) => Math.round(parseFloat(match[1]) * 10),
  },
  'Rotten Tomatoes': {
    source: 'rotten_tomatoes',
    pattern: /^(\d+)%$/,
    normalize: (match) => parseInt(match[1]),
  },
  'Metacritic': {
    source: 'metacritic',
    pattern: /^(\d+)\/100$/,
    normalize: (match) => parseInt(match[1]),
  },
}

interface NormalizedRating {
  source: string | null
  score: number | null
  raw: string
}

/**
 * Normalize rating to 0-100 scale
 */
function normalizeRating(rating: OMDbRating): NormalizedRating {
  const parser = RATING_PARSERS[rating.Source]
  if (!parser) {
    return { source: null, score: null, raw: rating.Value }
  }

  const match = rating.Value.match(parser.pattern)
  const score = match ? parser.normalize(match) : null

  return { source: parser.source, score, raw: rating.Value }
}

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = ReturnType<typeof createClient<any>>

/**
 * Delete a message from the score queue
 */
async function deleteQueueMessage(
  client: AnySupabaseClient,
  msgId: number | undefined
): Promise<void> {
  if (msgId !== undefined) {
    await client.rpc('delete_score_queue_message', { p_msg_id: msgId })
  }
}

Deno.serve(async (req) => {
  // This function is called by pg_cron, not by users, so no CORS handling needed
  // But we still validate the service role key

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const omdbApiKey = Deno.env.get('OMDB_API_KEY')
    const tmdbApiKey = Deno.env.get('TMDB_API_KEY')

    if (!omdbApiKey) {
      console.error('OMDB_API_KEY not configured')
      return errorResponse('OMDB_API_KEY not configured', 503)
    }

    if (!tmdbApiKey) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('TMDB_API_KEY not configured', 503)
    }

    // Parse request body
    const { movie_ids, msg_ids }: ProcessRequest = await req.json()

    if (!movie_ids || !Array.isArray(movie_ids) || movie_ids.length === 0) {
      return errorResponse('No movie_ids provided', 400)
    }

    const results = {
      processed: 0,
      scores_updated: 0,
      errors: [] as Array<{ movie_id: string; error: string }>,
    }

    // Process each movie in the batch
    for (let i = 0; i < movie_ids.length; i++) {
      const movieId = movie_ids[i]
      const msgId = msg_ids?.[i]

      try {
        // 1. Get movie details from database
        const { data: movie, error: movieError } = await serviceClient
          .from('movies')
          .select('id, tmdb_id, imdb_id, title')
          .eq('id', movieId)
          .single()

        if (movieError || !movie) {
          console.error(`Movie not found: ${movieId}`, movieError)
          results.errors.push({ movie_id: movieId, error: 'Movie not found' })
          await deleteQueueMessage(serviceClient, msgId)
          continue
        }

        const typedMovie = movie as MovieRecord

        // 2. Fetch IMDB ID from TMDB if missing
        let imdbId = typedMovie.imdb_id
        if (!imdbId && typedMovie.tmdb_id) {
          try {
            const tmdbRes = await fetch(
              `https://api.themoviedb.org/3/movie/${typedMovie.tmdb_id}/external_ids`,
              {
                headers: {
                  Authorization: `Bearer ${tmdbApiKey}`,
                  'Content-Type': 'application/json',
                },
              }
            )

            if (tmdbRes.ok) {
              const tmdbData: TMDbExternalIds = await tmdbRes.json()
              imdbId = tmdbData.imdb_id || null

              // Store the IMDB ID for future use
              if (imdbId) {
                await serviceClient
                  .from('movies')
                  .update({ imdb_id: imdbId })
                  .eq('id', movieId)
              }
            }
          } catch (tmdbError) {
            console.error(`TMDB API error for ${typedMovie.title}:`, tmdbError)
          }
        }

        // 3. Skip if we still don't have an IMDB ID
        if (!imdbId) {
          console.warn(`No IMDB ID available for: ${typedMovie.title}`)
          results.errors.push({ movie_id: movieId, error: 'No IMDB ID available' })
          await deleteQueueMessage(serviceClient, msgId)
          continue
        }

        // 4. Fetch scores from OMDB
        const omdbRes = await fetch(
          `https://www.omdbapi.com/?apikey=${omdbApiKey}&i=${imdbId}`
        )

        if (!omdbRes.ok) {
          console.error(`OMDB API error for ${typedMovie.title}: ${omdbRes.status}`)
          results.errors.push({
            movie_id: movieId,
            error: `OMDB API error: ${omdbRes.status}`,
          })
          // Don't delete message - allow retry
          continue
        }

        const omdbData: OMDbResponse = await omdbRes.json()

        if (omdbData.Response === 'False') {
          console.warn(`OMDB returned error for ${typedMovie.title}: ${omdbData.Error}`)
          results.errors.push({
            movie_id: movieId,
            error: omdbData.Error || 'Movie not found on OMDB',
          })
          await deleteQueueMessage(serviceClient, msgId)
          continue
        }

        // 5. Store ratings in reviews table
        let ratingsStored = 0
        if (omdbData.Ratings && omdbData.Ratings.length > 0) {
          for (const rating of omdbData.Ratings) {
            const { source, score, raw } = normalizeRating(rating)
            if (!source || score === null) continue

            const { error: reviewError } = await serviceClient
              .from('reviews')
              .upsert(
                {
                  movie_id: movieId,
                  source,
                  score,
                  raw_score: raw,
                  fetched_at: new Date().toISOString(),
                },
                { onConflict: 'movie_id,source' }
              )

            if (reviewError) {
              console.error(`Error upserting review for ${typedMovie.title}:`, reviewError)
            } else {
              ratingsStored++
            }
          }
        }

        // 6. Call PostgreSQL function to calculate weighted score
        if (ratingsStored > 0) {
          const { data: combinedScore, error: calcError } = await serviceClient.rpc(
            'calculate_movie_score',
            { p_movie_id: movieId }
          )

          if (calcError) {
            console.error(`Error calculating score for ${typedMovie.title}:`, calcError)
            results.errors.push({ movie_id: movieId, error: 'Failed to calculate combined score' })
          } else {
            console.log(`Calculated score for ${typedMovie.title}: ${combinedScore}`)
            results.scores_updated++
          }
        } else {
          console.warn(`No ratings stored for ${typedMovie.title} - OMDB returned no recognized ratings`)
        }

        // 7. Delete processed message from queue
        await deleteQueueMessage(serviceClient, msgId)

        results.processed++

        // Small delay to respect API rate limits
        await new Promise((resolve) => setTimeout(resolve, 100))
      } catch (error) {
        console.error(`Error processing movie ${movieId}:`, error)
        results.errors.push({
          movie_id: movieId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        // Don't delete message on unexpected errors - allow retry via visibility timeout
      }
    }

    return jsonResponse(results)
  } catch (error) {
    console.error('Unexpected error in process-movie-scores:', error)
    return errorResponse('Internal server error', 500)
  }
})
