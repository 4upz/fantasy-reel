import { config } from '../config.js'

export interface EdgeFunctionResult<T> {
  data: T | null
  error: string | null
}

async function callEdgeFunction<T>(functionName: string, body: unknown): Promise<EdgeFunctionResult<T>> {
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.supabaseServiceRoleKey}`,
        'apikey': config.supabaseServiceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return { data: null, error: `${functionName} returned ${response.status}` }
    }

    const data = (await response.json()) as T
    return { data, error: null }
  } catch (err) {
    console.error(`Failed to call ${functionName}:`, err)
    return { data: null, error: 'Network error contacting movie data service' }
  }
}

export interface TMDbSearchResult {
  tmdb_id: number
  title: string
  overview: string | null
  release_date: string | null
  poster_url: string | null
  vote_average: number
  popularity: number
  genre_ids: number[]
}

export interface SearchMoviesResponse {
  page: number
  total_pages: number
  total_results: number
  results: TMDbSearchResult[]
}

export function searchMovies(
  query: string,
  opts: { page?: number; upcoming_only?: boolean } = {}
): Promise<EdgeFunctionResult<SearchMoviesResponse>> {
  return callEdgeFunction('search-movies', { query, ...opts })
}

export interface BrowseMoviesResult extends TMDbSearchResult {
  backdrop_url: string | null
}

export interface BrowseMoviesResponse {
  page: number
  total_pages: number
  total_results: number
  results: BrowseMoviesResult[]
}

export function browseMovies(
  opts: {
    page?: number
    genres?: number[]
    release_window?: 'next30' | 'quarter' | 'year' | 'all'
    min_rating?: number
    sort_by?: 'popularity' | 'release_date'
    trending?: boolean
  } = {}
): Promise<EdgeFunctionResult<BrowseMoviesResponse>> {
  return callEdgeFunction('browse-movies', opts)
}

export interface MovieDetailsResponse {
  tmdb_id: number
  imdb_id: string | null
  title: string
  tagline: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string
  poster_url: string | null
  backdrop_url: string | null
  vote_average: number
  vote_count: number
  genres: Array<{ id: number; name: string }>
  cast: Array<{ id: number; name: string; character: string; profile_url: string | null }>
  director: string | null
}

export function getMovieDetails(tmdbId: number): Promise<EdgeFunctionResult<MovieDetailsResponse>> {
  return callEdgeFunction('get-movie-details', { tmdb_id: tmdbId })
}
