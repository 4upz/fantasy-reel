import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'

interface BrowseMoviesRequest {
  page?: number
  genres?: number[]
  release_window?: 'next30' | 'quarter' | 'year' | 'all'
  min_rating?: number
  sort_by?: 'popularity' | 'release_date'
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
}

interface TMDbDiscoverResponse {
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

function getReleaseDateRange(releaseWindow: BrowseMoviesRequest['release_window']): { gte: string; lte: string } {
  const today = new Date()
  const gte = today.toISOString().split('T')[0]

  let lte: string
  switch (releaseWindow) {
    case 'next30': {
      const futureDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
      lte = futureDate.toISOString().split('T')[0]
      break
    }
    case 'quarter': {
      const futureDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
      lte = futureDate.toISOString().split('T')[0]
      break
    }
    case 'all': {
      // Two years out for "all"
      const futureDate = new Date(today.getFullYear() + 2, 11, 31)
      lte = futureDate.toISOString().split('T')[0]
      break
    }
    case 'year':
    default: {
      lte = `${today.getFullYear()}-12-31`
      break
    }
  }

  return { gte, lte }
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

    const {
      page = 1,
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
      return errorResponse('Failed to browse movies', 502)
    }

    const tmdbData: TMDbDiscoverResponse = await tmdbResponse.json()

    const results: BrowseResult[] = tmdbData.results.map((movie) => ({
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

    return jsonResponse({
      page: tmdbData.page,
      total_pages: tmdbData.total_pages,
      total_results: tmdbData.total_results,
      results,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
