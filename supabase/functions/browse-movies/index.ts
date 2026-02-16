import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

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

class TMDbApiError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`TMDb API error: ${status}`)
    this.status = status
    this.body = body
  }
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

async function fetchTMDbPage(url: string, token: string): Promise<TMDbResponse> {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new TMDbApiError(response.status, await response.text())
  }

  return response.json()
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

async function fetchTrendingMovies(
  clientPage: number,
  tmdbToken: string
): Promise<{ page: number; total_pages: number; total_results: number; results: BrowseResult[] }> {
  const today = toDateString(new Date())
  const accumulated: BrowseResult[] = []
  let tmdbPage = (clientPage - 1) * MAX_TMDB_FETCHES + 1
  let fetches = 0
  let totalTmdbPages = 1
  let totalTmdbResults = 0
  let keptCount = 0
  let scannedCount = 0

  while (accumulated.length < TARGET_PAGE_SIZE && fetches < MAX_TMDB_FETCHES && tmdbPage <= totalTmdbPages) {
    const url = `https://api.themoviedb.org/3/trending/movie/week?language=en-US&include_adult=false&page=${tmdbPage}`
    const data = await fetchTMDbPage(url, tmdbToken)

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
      console.error('TMDB_API_KEY not configured')
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

    // Trending path: aggregate multiple TMDb pages server-side
    if (trending) {
      console.log(`Fetching trending movies (client page ${page})`)
      const trendingData = await fetchTrendingMovies(page, tmdbToken)
      return jsonResponse(trendingData)
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
    tmdbUrl.searchParams.set('certification_country', 'US')
    tmdbUrl.searchParams.set('certification.lte', 'R')
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

    console.log(`Browsing movies from TMDb: ${tmdbUrl.toString()}`)

    const tmdbData = await fetchTMDbPage(tmdbUrl.toString(), tmdbToken)
    const results = transformResults(tmdbData.results)

    return jsonResponse({
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: tmdbData.total_results,
      results,
    })
  } catch (error) {
    if (error instanceof TMDbApiError) {
      if (error.status === 401) {
        return errorResponse('TMDb API authentication failed', 401)
      }
      if (error.status === 429) {
        return errorResponse('TMDb rate limit exceeded. Try again later.', 429)
      }
      console.error('TMDb API error:', error.status, error.body)
      return errorResponse('Failed to browse movies', 502)
    }
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
