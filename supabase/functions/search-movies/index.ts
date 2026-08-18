import { jsonResponse, errorResponse, handleCorsPreflightRequest, isUpcomingMovie, internalErrorResponse } from '../_shared/utils.ts'
import { fetchWithRetry } from '../_shared/http.ts'
import { createLogger } from '../_shared/logger.ts'
import { buildCacheKey, cachedTmdbFetch } from '../_shared/tmdb-cache.ts'

const log = createLogger('search-movies')

/**
 * Search results are identical for every user and TMDb's catalog barely moves
 * within an hour, while the draft board's debounced typeahead sends the same
 * prefixes over and over -- so an hour of caching removes most of the calls
 * without anyone seeing a stale result set.
 */
const SEARCH_TTL_SECONDS = 60 * 60

interface SearchMoviesRequest {
  query: string
  page?: number
  year?: number
  upcoming_only?: boolean
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
  adult?: boolean
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

interface SearchPage {
  page: number
  total_pages: number
  total_results: number
  results: SearchResult[]
}

class TMDbApiError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`TMDb API error: ${status}`)
    this.status = status
    this.body = body
  }
}

/**
 * Filters search results to only include upcoming movies from the current year or later.
 * Only used when upcoming_only=true is explicitly passed.
 *
 * Applied *after* the cache, never before it: the cutoff is relative to today,
 * so a cached filtered page would silently keep last year's answer. Caching
 * the unfiltered page also lets both upcoming_only variants share one entry.
 */
function filterUpcomingMovies(results: SearchResult[]): SearchResult[] {
  return results.filter((movie) => isUpcomingMovie(movie.release_date).valid)
}

async function fetchSearchPage(url: string, tmdbToken: string): Promise<SearchPage> {
  const tmdbResponse = await fetchWithRetry(url, {
    headers: {
      'Authorization': `Bearer ${tmdbToken}`,
      'Content-Type': 'application/json',
    },
  }, { timeoutMs: 10_000, retries: 1 })

  if (!tmdbResponse.ok) {
    throw new TMDbApiError(tmdbResponse.status, await tmdbResponse.text())
  }

  const tmdbData: TMDbSearchResponse = await tmdbResponse.json()

  return {
    page: tmdbData.page,
    total_pages: tmdbData.total_pages,
    total_results: tmdbData.total_results,
    results: tmdbData.results
      .filter((movie) => !movie.adult)
      .map((movie) => ({
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
      })),
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse('Search service not configured', 503)
    }

    let params: SearchMoviesRequest
    try {
      params = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { query, page = 1, year, upcoming_only = false } = params

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

    // Case and surrounding whitespace never change what TMDb returns, so
    // normalizing them in the key collapses "Dune", "dune " and " DUNE" onto
    // one entry. Only the key is normalized -- TMDb still gets the raw query.
    const cacheKey = buildCacheKey('search', {
      q: query.trim().toLowerCase(),
      page,
      year,
    })

    const { payload } = await cachedTmdbFetch<SearchPage>(
      cacheKey,
      SEARCH_TTL_SECONDS,
      () => fetchSearchPage(tmdbUrl.toString(), tmdbToken),
      log
    )

    // Filter to only include upcoming movies if requested (default for draft contexts)
    const results = upcoming_only ? filterUpcomingMovies(payload.results) : payload.results

    return jsonResponse({
      page: payload.page,
      total_pages: payload.total_pages,
      total_results: upcoming_only ? results.length : payload.total_results,
      results,
    })
  } catch (error) {
    // Only reached when the cache had nothing to fall back on -- a hit or an
    // expired entry answers a rate-limited or failing TMDb before this.
    if (error instanceof TMDbApiError) {
      if (error.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (error.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      log.error('TMDb API error', { status: error.status, body: error.body })
      return errorResponse('Failed to search movies', 502)
    }
    return internalErrorResponse(error, log)
  }
})
