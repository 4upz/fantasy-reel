import { config } from '../config.js'
import { TtlCache } from './ttl-cache.js'

export interface EdgeFunctionResult<T> {
  data: T | null
  error: string | null
}

/** Never cache a result that came back as an error -- only successful lookups are stable enough to reuse. */
function isSuccess<T>(result: EdgeFunctionResult<T>): boolean {
  return result.error === null
}

const SEARCH_TTL_MS = 10 * 60 * 1000 // 10 minutes -- autocomplete re-queries the same prefixes constantly
const DETAILS_TTL_MS = 60 * 60 * 1000 // 1 hour -- movie metadata rarely changes within a session
const BROWSE_TTL_MS = 15 * 60 * 1000 // 15 minutes -- top-available filters this against league state per call, so the raw list is safe to reuse

const searchCache = new TtlCache<string, EdgeFunctionResult<SearchMoviesResponse>>(SEARCH_TTL_MS)
const detailsCache = new TtlCache<number, EdgeFunctionResult<MovieDetailsResponse>>(DETAILS_TTL_MS)
const browseCache = new TtlCache<string, EdgeFunctionResult<BrowseMoviesResponse>>(BROWSE_TTL_MS)

/** Test-only: drops all cached entries so each test starts from a clean cache. */
export function clearFunctionCaches(): void {
  searchCache.clear()
  detailsCache.clear()
  browseCache.clear()
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
  // Autocomplete re-sends near-identical queries on almost every keystroke, so
  // normalize the query before keying the cache -- "Dune", "dune", " Dune "
  // should all share one entry.
  const cacheKey = JSON.stringify({ query: query.trim().toLowerCase(), ...opts })
  return searchCache.getOrFetch(
    cacheKey,
    () => callEdgeFunction('search-movies', { query, ...opts }),
    isSuccess
  )
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
  // Safe to cache the raw browse response: callers (e.g. top-available) filter
  // it against per-league roster state after the fetch, not before.
  const cacheKey = JSON.stringify(opts)
  return browseCache.getOrFetch(cacheKey, () => callEdgeFunction('browse-movies', opts), isSuccess)
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
  return detailsCache.getOrFetch(
    tmdbId,
    () => callEdgeFunction('get-movie-details', { tmdb_id: tmdbId }),
    isSuccess
  )
}
