import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

interface SyncMoviesRequest {
  year?: number
  page?: number
  region?: string
}

interface TMDbMovie {
  id: number
  title: string
  overview: string
  release_date: string
  poster_path: string | null
  backdrop_path: string | null
  popularity: number
  vote_average: number
  vote_count: number
}

interface TMDbResponse {
  page: number
  results: TMDbMovie[]
  total_pages: number
  total_results: number
}

interface TMDbExternalIds {
  imdb_id: string | null
  facebook_id: string | null
  instagram_id: string | null
  twitter_id: string | null
}

/**
 * Fetch external IDs (including IMDb ID) for a movie from TMDb
 */
async function fetchExternalIds(
  tmdbId: number,
  token: string
): Promise<string | null> {
  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.warn(`Failed to fetch external IDs for TMDb ID ${tmdbId}: ${response.status}`)
      return null
    }

    const data: TMDbExternalIds = await response.json()
    return data.imdb_id || null
  } catch (error) {
    console.warn(`Error fetching external IDs for TMDb ID ${tmdbId}:`, error)
    return null
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('Movie sync service not configured', 503)
    }

    // Create service role client (movies table is restricted)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body (optional parameters)
    let params: SyncMoviesRequest = {}
    try {
      if (req.method === 'POST') {
        const body = await req.text()
        if (body) {
          params = JSON.parse(body)
        }
      }
    } catch {
      // Ignore parse errors, use defaults
    }

    const currentYear = new Date().getFullYear()
    const year = params.year || currentYear
    const page = params.page || 1
    const region = params.region || 'US'

    // Calculate date range for upcoming movies
    const today = new Date().toISOString().split('T')[0]
    const endOfYear = `${year}-12-31`

    // Fetch from TMDb discover endpoint
    const tmdbUrl = new URL('https://api.themoviedb.org/3/discover/movie')
    tmdbUrl.searchParams.set('language', 'en-US')
    tmdbUrl.searchParams.set('region', region)
    tmdbUrl.searchParams.set('sort_by', 'popularity.desc')
    tmdbUrl.searchParams.set('include_adult', 'false')
    tmdbUrl.searchParams.set('include_video', 'false')
    tmdbUrl.searchParams.set('page', page.toString())
    tmdbUrl.searchParams.set('primary_release_date.gte', today)
    tmdbUrl.searchParams.set('primary_release_date.lte', endOfYear)
    tmdbUrl.searchParams.set('with_release_type', '2|3') // Theatrical releases

    console.log(`Fetching movies from TMDb: ${tmdbUrl.toString()}`)

    const tmdbResponse = await fetch(tmdbUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${tmdbToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!tmdbResponse.ok) {
      if (tmdbResponse.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (tmdbResponse.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      console.error('TMDb API error:', tmdbResponse.status, await tmdbResponse.text())
      return errorResponse('Failed to fetch movies from TMDb', 502)
    }

    const tmdbData: TMDbResponse = await tmdbResponse.json()

    if (!tmdbData.results || tmdbData.results.length === 0) {
      return jsonResponse({
        synced_count: 0,
        inserted_count: 0,
        updated_count: 0,
        movies: [],
        page: tmdbData.page,
        total_pages: tmdbData.total_pages
      })
    }

    // Fetch external IDs (including IMDb IDs) for each movie
    // Process in batches to respect TMDb rate limits (40 requests per 10 seconds)
    console.log(`Fetching IMDb IDs for ${tmdbData.results.length} movies...`)
    const moviesWithImdbIds: Array<{ movie: TMDbMovie; imdb_id: string | null }> = []

    for (const movie of tmdbData.results) {
      const imdb_id = await fetchExternalIds(movie.id, tmdbToken)
      moviesWithImdbIds.push({ movie, imdb_id })
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // Transform movies to our schema
    const moviesToUpsert = moviesWithImdbIds.map(({ movie, imdb_id }) => ({
      tmdb_id: movie.id,
      imdb_id,
      title: movie.title,
      overview: movie.overview || null,
      release_date: movie.release_date || null,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      backdrop_url: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      popularity: movie.popularity,
      vote_average: movie.vote_average,
      vote_count: movie.vote_count,
      status: 'upcoming',
      last_synced_at: new Date().toISOString()
    }))

    // Upsert movies (insert or update on conflict)
    const { data: upsertedMovies, error: upsertError } = await serviceClient
      .from('movies')
      .upsert(moviesToUpsert, {
        onConflict: 'tmdb_id',
        ignoreDuplicates: false
      })
      .select('id, tmdb_id, title, release_date')

    if (upsertError) {
      console.error('Error upserting movies:', upsertError)
      return errorResponse('Failed to save movies to database', 500)
    }

    // Count new vs updated (approximate - upsert doesn't distinguish)
    const syncedCount = upsertedMovies?.length || 0

    return jsonResponse({
      synced_count: syncedCount,
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: tmdbData.total_results,
      movies: upsertedMovies?.map(m => ({
        tmdb_id: m.tmdb_id,
        title: m.title,
        release_date: m.release_date
      })) || []
    })

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
