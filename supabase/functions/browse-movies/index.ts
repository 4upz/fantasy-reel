import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse, authenticateUserOrServiceRole, isUpcomingMovie } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { buildCacheKey, cacheKeyForUrl, cachedTmdbFetch } from '../_shared/tmdb-cache.ts'
import { discoveryPage, releaseDateRange } from '../_shared/movie-discovery.ts'
import { TMDbApiError, tmdbErrorResponse, tmdbGetJson } from '../_shared/tmdb.ts'

const log = createLogger('browse-movies')

interface BrowseMoviesRequest {
  page?: number
  genres?: number[]
  release_window?: 'next30' | 'quarter' | 'year' | 'all'
  sort_by?: 'popularity' | 'release_date'
  trending?: boolean
  season_year?: number
}

interface TMDbMovie {
  id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids: number[]
  adult?: boolean
}

interface TMDbResponse {
  page: number
  results: TMDbMovie[]
  total_pages: number
  total_results: number
}

interface BrowseResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  backdrop_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

function transformResults(movies: TMDbMovie[]): BrowseResult[] {
  return movies
    .filter((movie) => !movie.adult)
    .map((movie) => ({
      tmdb_id: movie.id,
      title: movie.title,
      overview: movie.overview,
      release_date: movie.release_date,
      poster_url: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      backdrop_url: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      vote_average: movie.vote_average,
      popularity: movie.popularity,
      genre_ids: movie.genre_ids,
    }))
}

const DISCOVER_TTL_SECONDS = 30 * 60
const TRENDING_TTL_SECONDS = 12 * 60 * 60

type BrowsePage = ReturnType<typeof discoveryPage<BrowseResult>>

// One client page is exactly one upstream page. This preserves every result
// and makes an empty filtered page distinct from the end of the catalog.
async function fetchTrendingMovies(page: number, tmdbToken: string, seasonYear: number): Promise<BrowsePage> {
  const url = `https://api.themoviedb.org/3/trending/movie/week?language=en-US&page=${page}`
  const data = await tmdbGetJson<TMDbResponse>(url, tmdbToken)
  return discoveryPage(data, transformResults(data.results)
    .filter(movie => isUpcomingMovie(movie.release_date, seasonYear).valid), 1000)
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Any signed-in user, or the service role (the Discord bot) -- see
    // authenticateUserOrServiceRole for why that is the whole check here.
    const authError = await authenticateUserOrServiceRole(req)
    if (authError) return authError

    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!tmdbToken) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse('Browse service not configured', 503)
    }

    let params: BrowseMoviesRequest = {}
    try {
      if (req.method === 'POST') {
        const body = await req.text()
        if (body) {
          params = JSON.parse(body)
        }
      }
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return errorResponse('Invalid request body', 400)
    }

    const { page = 1, trending = false, season_year = new Date().getUTCFullYear() } = params
    const pageLimit = trending ? 1000 : 500
    if (!Number.isInteger(page) || page < 1 || page > pageLimit) {
      return errorResponse(`Page must be between 1 and ${pageLimit}`, 400)
    }
    if (!Number.isInteger(season_year) || season_year < 1900 || season_year > 3000) {
      return errorResponse('Invalid season year', 400)
    }

    // Computed once and threaded through both the cache key and the fetch:
    // "today" appearing twice could otherwise straddle midnight and key a page
    // under one date while filtering it by another.
    const today = new Date().toISOString().slice(0, 10)

    // Versioned key prevents old aggregated pages being interpreted as raw pages.
    if (trending) {
      const payload = await cachedTmdbFetch<BrowsePage>(
        buildCacheKey('browse', { trending: true, page, today, season_year, paging: 2 }),
        TRENDING_TTL_SECONDS,
        () => fetchTrendingMovies(page, tmdbToken, season_year),
        log
      )
      return jsonResponse(payload)
    }

    // Standard discover path
    const {
      genres = [],
      release_window = 'year',
      sort_by = 'popularity',
    } = params

    if (!['next30', 'quarter', 'year', 'all'].includes(release_window)) {
      return errorResponse('Invalid release window', 400)
    }
    if (!Array.isArray(genres) || genres.some(genre => !Number.isInteger(genre) || genre <= 0)) {
      return errorResponse('Genres must be numeric genre IDs', 400)
    }
    const { gte, lte } = releaseDateRange(release_window)

    const tmdbUrl = new URL('https://api.themoviedb.org/3/discover/movie')
    tmdbUrl.searchParams.set('language', 'en-US')
    tmdbUrl.searchParams.set('region', 'US')
    tmdbUrl.searchParams.set('include_adult', 'false')
    tmdbUrl.searchParams.set('include_video', 'false')
    // No certification filter. `certification.lte=R` is not "R or milder" on
    // TMDb -- it is an inner join onto the certification table, so anything
    // without a US rating yet is dropped entirely. Ratings are assigned close
    // to release, so that excluded almost every upcoming movie: on the default
    // year window this filter cut discover from 2859 results to 210, and a
    // dropped movie a team wanted to re-bid on (The Cat in the Hat, Nov 2026)
    // was unreachable on all 11 remaining pages while sitting on page 2
    // without it. Adult content is already excluded by include_adult=false.
    tmdbUrl.searchParams.set('page', page.toString())
    tmdbUrl.searchParams.set('primary_release_date.gte', gte)
    tmdbUrl.searchParams.set('primary_release_date.lte', lte)
    tmdbUrl.searchParams.set('with_release_type', '2|3') // Theatrical releases

    // Sort order
    if (sort_by === 'release_date') {
      tmdbUrl.searchParams.set('sort_by', 'primary_release_date.asc')
    } else {
      tmdbUrl.searchParams.set('sort_by', 'popularity.desc')
    }

    // Genre filter
    if (genres.length > 0) {
      tmdbUrl.searchParams.set('with_genres', genres.join(','))
    }

    // Keyed off the request URL itself, so every param that can change the
    // response is in the key by construction -- including the resolved
    // primary_release_date bounds, which pin the window to a concrete day.
    const cacheKey = cacheKeyForUrl('browse', tmdbUrl)

    const payload = await cachedTmdbFetch<BrowsePage>(
      cacheKey,
      DISCOVER_TTL_SECONDS,
      async () => {
        const tmdbData = await tmdbGetJson<TMDbResponse>(tmdbUrl.toString(), tmdbToken)
        return discoveryPage(tmdbData, transformResults(tmdbData.results))
      },
      log
    )

    return jsonResponse(discoveryPage(payload, payload.results
      .filter(movie => isUpcomingMovie(movie.release_date, season_year).valid)))
  } catch (error) {
    // Only reached when the cache had nothing to fall back on -- a hit or an
    // expired entry answers a rate-limited or failing TMDb before this.
    if (error instanceof TMDbApiError) {
      return tmdbErrorResponse(error, log, 'Failed to browse movies')
    }
    return internalErrorResponse(error, log)
  }
})
