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

/**
 * Stable, order-insensitive cache key: sorts object keys and drops
 * undefined/null values so `{page: 1, trending: true}` and
 * `{trending: true, page: 1}` collapse to the same entry instead of
 * fragmenting the cache by call-site argument order.
 */
function stableKey(obj: Record<string, unknown>): string {
  const sortedEntries = Object.keys(obj)
    .filter((key) => obj[key] !== undefined && obj[key] !== null)
    .sort()
    .map((key) => [key, obj[key]] as const)
  return JSON.stringify(sortedEntries)
}

// The Edge Functions these wrap already cache TMDb responses server-side
// (Postgres `tmdb_cache`) with their own authoritative TTLs. This bot-side
// cache exists only to skip the network round trip when it can -- mainly to
// stay inside Discord's 3-second autocomplete deadline -- so these TTLs
// should stay at or below the server's.
const SEARCH_TTL_MS = 10 * 60 * 1000 // 10 minutes -- autocomplete re-queries the same prefixes constantly
const DETAILS_TTL_MS = 60 * 60 * 1000 // 1 hour -- movie metadata rarely changes within a session
const BROWSE_TTL_MS = 15 * 60 * 1000 // 15 minutes -- top-available filters this against league state per call, so the raw list is safe to reuse

// One shared cache for all edge-function lookups, keyed `${fnName}:${stableKey(...)}`
// so entries from different endpoints never collide. Each call supplies its own
// TTL via `cachedCall`, and `clearFunctionCaches` only has one instance to reset.
const cache = new TtlCache<string, unknown>(SEARCH_TTL_MS)

/** Test-only: drops all cached entries so each test starts from a clean cache. */
export function clearFunctionCaches(): void {
  cache.clear()
}

/**
 * Calls `fetch()` and caches its result under `${fnName}:${stableKey(keyInput)}`
 * for `ttlMs`. `keyInput` need not match the request body exactly (e.g. a
 * normalized query string) -- it only determines cache identity.
 */
function cachedCall<T>(
  fnName: string,
  keyInput: Record<string, unknown>,
  ttlMs: number,
  fetch: () => Promise<EdgeFunctionResult<T>>
): Promise<EdgeFunctionResult<T>> {
  const cacheKey = `${fnName}:${stableKey(keyInput)}`
  return cache.getOrFetch(
    cacheKey,
    fetch,
    (value) => isSuccess(value as EdgeFunctionResult<T>),
    ttlMs
  ) as Promise<EdgeFunctionResult<T>>
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
  const normalizedQuery = query.trim().toLowerCase()
  return cachedCall<SearchMoviesResponse>(
    'search-movies',
    { query: normalizedQuery, ...opts },
    SEARCH_TTL_MS,
    () => callEdgeFunction('search-movies', { query, ...opts })
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
  return cachedCall<BrowseMoviesResponse>('browse-movies', opts, BROWSE_TTL_MS, () =>
    callEdgeFunction('browse-movies', opts)
  )
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
  return cachedCall<MovieDetailsResponse>(
    'get-movie-details',
    { tmdb_id: tmdbId },
    DETAILS_TTL_MS,
    () => callEdgeFunction('get-movie-details', { tmdb_id: tmdbId })
  )
}
