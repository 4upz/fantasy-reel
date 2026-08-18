import { jsonResponse, errorResponse, handleCorsPreflightRequest, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { buildCacheKey, cacheKeyForUrl, cachedTmdbFetch } from '../_shared/tmdb-cache.ts'
import { TMDbApiError, tmdbErrorResponse, tmdbGetJson } from '../_shared/tmdb.ts'

const log = createLogger('browse-movies')

interface BrowseMoviesRequest {
  page?: number
  genres?: number[]
  release_window?: 'next30' | 'quarter' | 'year' | 'all'
  min_rating?: number
  sort_by?: 'popularity' | 'release_date'
  trending?: boolean
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

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function getReleaseDateRange(releaseWindow: BrowseMoviesRequest['release_window']): { gte: string; lte: string } {
  const today = new Date()
  const gte = toDateString(today)

  let lte: string
  switch (releaseWindow) {
    case 'next30':
      lte = toDateString(addDays(today, 30))
      break
    case 'quarter':
      lte = toDateString(addDays(today, 90))
      break
    case 'all':
      lte = toDateString(new Date(today.getFullYear() + 2, 11, 31))
      break
    case 'year':
    default:
      lte = `${today.getFullYear()}-12-31`
      break
  }

  return { gte, lte }
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

const TARGET_PAGE_SIZE = 20
const MAX_TMDB_FETCHES = 5

/**
 * Browse results are the same for every user, so both paths cache on their
 * request parameters alone.
 *
 * Discover is short-lived (30 min): popularity ordering shifts through the
 * day and a newly added title should surface the same day. Trending is a
 * weekly TMDb window that barely moves, and each client page costs up to
 * MAX_TMDB_FETCHES TMDb calls -- by far the most expensive request this
 * function serves -- so it holds for 12 hours.
 *
 * Both keys carry the date the window was computed for. Every date bound here
 * is relative to "today", so without it a cached entry would keep serving a
 * stale window across midnight.
 */
const DISCOVER_TTL_SECONDS = 30 * 60
const TRENDING_TTL_SECONDS = 12 * 60 * 60

interface BrowsePage {
  page: number
  total_pages: number
  total_results: number
  results: BrowseResult[]
}

async function fetchTrendingMovies(
  clientPage: number,
  tmdbToken: string,
  today: string
): Promise<BrowsePage> {
  const accumulated: BrowseResult[] = []
  let tmdbPage = (clientPage - 1) * MAX_TMDB_FETCHES + 1
  let fetches = 0
  let totalTmdbPages = 1
  let totalTmdbResults = 0
  let keptCount = 0
  let scannedCount = 0

  while (accumulated.length < TARGET_PAGE_SIZE && fetches < MAX_TMDB_FETCHES && tmdbPage <= totalTmdbPages) {
    const url = `https://api.themoviedb.org/3/trending/movie/week?language=en-US&include_adult=false&page=${tmdbPage}`
    const data = await tmdbGetJson<TMDbResponse>(url, tmdbToken)

    totalTmdbPages = data.total_pages
    totalTmdbResults = data.total_results
    scannedCount += data.results.length

    const unreleased = data.results.filter((movie) => !movie.release_date || movie.release_date >= today)

    keptCount += unreleased.length
    accumulated.push(...transformResults(unreleased))

    tmdbPage++
    fetches++
  }

  // Estimate total pages based on observed keep ratio
  const keepRatio = scannedCount > 0 ? keptCount / scannedCount : 0.05
  const estimatedTotalUnreleased = Math.floor(totalTmdbResults * keepRatio)
  const estimatedTotalPages = Math.max(1, Math.ceil(estimatedTotalUnreleased / TARGET_PAGE_SIZE))

  return {
    page: clientPage,
    total_pages: estimatedTotalPages,
    total_results: estimatedTotalUnreleased,
    results: accumulated.slice(0, TARGET_PAGE_SIZE),
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
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
      // Use defaults if parsing fails
    }

    const { page = 1, trending = false } = params

    // Computed once and threaded through both the cache key and the fetch:
    // "today" appearing twice could otherwise straddle midnight and key a page
    // under one date while filtering it by another.
    const today = toDateString(new Date())

    // Trending path: aggregate multiple TMDb pages server-side. The cached
    // value is the finished aggregate, not the individual TMDb pages, so a hit
    // replaces the whole multi-fetch loop rather than one call of it.
    if (trending) {
      const payload = await cachedTmdbFetch<BrowsePage>(
        buildCacheKey('browse', { trending: true, page, today }),
        TRENDING_TTL_SECONDS,
        () => fetchTrendingMovies(page, tmdbToken, today),
        log
      )
      return jsonResponse(payload)
    }

    // Standard discover path
    const {
      genres = [],
      release_window = 'year',
      min_rating = 0,
      sort_by = 'popularity',
    } = params

    const { gte, lte } = getReleaseDateRange(release_window)

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

    // Min rating filter
    if (min_rating > 0) {
      tmdbUrl.searchParams.set('vote_average.gte', min_rating.toString())
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
        return {
          page: tmdbData.page,
          total_pages: tmdbData.total_pages,
          total_results: tmdbData.total_results,
          results: transformResults(tmdbData.results),
        }
      },
      log
    )

    return jsonResponse(payload)
  } catch (error) {
    // Only reached when the cache had nothing to fall back on -- a hit or an
    // expired entry answers a rate-limited or failing TMDb before this.
    if (error instanceof TMDbApiError) {
      return tmdbErrorResponse(error, log, 'Failed to browse movies')
    }
    return internalErrorResponse(error, log)
  }
})
