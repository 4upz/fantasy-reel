import { jsonResponse, errorResponse, handleCorsPreflightRequest, isUpcomingMovie } from '../_shared/utils.ts'

interface SearchMoviesRequest {
  query: string
  page?: number
  year?: number
}

interface TMDbMovie {
  id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids: number[]
}

interface TMDbSearchResponse {
  page: number
  results: TMDbMovie[]
  total_pages: number
  total_results: number
}

interface SearchResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

/**
 * Filters search results to only include upcoming movies from the current year or later.
 */
function filterUpcomingMovies(results: SearchResult[]): SearchResult[] {
  return results.filter((movie) => isUpcomingMovie(movie.release_date).valid)
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('Search service not configured', 503)
    }

    let params: SearchMoviesRequest
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { query, page = 1, year } = params

    if (!query || query.trim().length === 0) {
      return errorResponse('Query is required', 400)
    }

    const tmdbUrl = new URL('https://api.themoviedb.org/3/search/movie')
    tmdbUrl.searchParams.set('query', query.trim())
    tmdbUrl.searchParams.set('page', page.toString())
    tmdbUrl.searchParams.set('include_adult', 'false')
    tmdbUrl.searchParams.set('language', 'en-US')

    if (year) {
      tmdbUrl.searchParams.set('year', year.toString())
    }

    console.log(`Searching TMDb: ${tmdbUrl.toString()}`)

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
      return errorResponse('Failed to search movies', 502)
    }

    const tmdbData: TMDbSearchResponse = await tmdbResponse.json()

    const mappedResults: SearchResult[] = tmdbData.results.map((movie) => ({
      tmdb_id: movie.id,
      title: movie.title,
      overview: movie.overview,
      release_date: movie.release_date,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      vote_average: movie.vote_average,
      popularity: movie.popularity,
      genre_ids: movie.genre_ids,
    }))

    // Filter to only include upcoming movies from current year or later
    const results = filterUpcomingMovies(mappedResults)

    return jsonResponse({
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: results.length,
      results,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
