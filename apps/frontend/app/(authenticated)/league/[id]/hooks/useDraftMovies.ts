import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { TMDbSearchResult, TMDbSearchResponse } from '@/types'

export interface BrowseFilters {
  releaseWindow: 'next30' | 'quarter' | 'year' | 'all'
  genres: number[]
  minRating: number
}

interface BrowseResponse {
  page: number
  total_pages: number
  total_results: number
  results: TMDbSearchResult[]
}

type PaginatedResponse = TMDbSearchResponse | BrowseResponse

type Mode = 'browse' | 'search' | 'trending'

/** Movie lists are browsed repeatedly within a session; a minute is plenty fresh. */
const LIST_TTL_MS = 60_000
const SEARCH_DEBOUNCE_MS = 300

const DEFAULT_FILTERS: BrowseFilters = {
  releaseWindow: 'year',
  genres: [],
  minRating: 0,
}

/**
 * What list is being shown. Held as state so it can drive the SWR key: the same
 * request always resolves to the same cache entry, which is what stops a
 * remounting draft board or bid modal from re-hitting TMDb.
 */
type Request =
  | { mode: 'browse'; filters: BrowseFilters }
  | { mode: 'search'; query: string }
  | { mode: 'trending' }

/**
 * SWR key for one page of one request. The body is serialized into the key so
 * the fetcher can rebuild it without closing over anything, and so two
 * equivalent requests hash to the same string.
 */
type PageKey = [functionName: string, serializedBody: string]

function buildPageKey(request: Request, page: number): PageKey {
  switch (request.mode) {
    case 'search':
      return ['search-movies', JSON.stringify({ query: request.query, page, upcoming_only: true })]
    case 'trending':
      return ['browse-movies', JSON.stringify({ page, trending: true })]
    case 'browse':
      return [
        'browse-movies',
        JSON.stringify({
          page,
          release_window: request.filters.releaseWindow,
          genres: request.filters.genres.length > 0 ? request.filters.genres : undefined,
          min_rating: request.filters.minRating > 0 ? request.filters.minRating : undefined,
          sort_by: 'popularity',
        }),
      ]
  }
}

async function fetcher([functionName, serializedBody]: PageKey): Promise<PaginatedResponse> {
  const { data, error } = await callEdgeFunction<PaginatedResponse>(functionName, {
    body: JSON.parse(serializedBody) as Record<string, unknown>,
  })
  if (error) throw new Error(error)
  if (!data) throw new Error('No data returned')
  return data
}

interface UseDraftMoviesOptions {
  draftedTmdbIds: Set<number>
  /**
   * Skip the initial browse. Set false where the movie list is supplied from
   * elsewhere -- e.g. the bid modal past the new-bid cutoff, which offers only
   * the movies already being bid on and would otherwise fetch a TMDb page it
   * never shows.
   */
  enabled?: boolean
}

interface UseDraftMoviesReturn {
  movies: TMDbSearchResult[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  page: number
  totalPages: number
  totalResults: number
  mode: Mode
  search: (query: string) => void
  browse: (filters: BrowseFilters) => void
  fetchTrending: (trendingPage?: number, append?: boolean) => void
  loadMore: () => void
  clearSearch: () => void
}

export function useDraftMovies({ draftedTmdbIds, enabled = true }: UseDraftMoviesOptions): UseDraftMoviesReturn {
  const [request, setRequest] = useState<Request | null>(
    enabled ? { mode: 'browse', filters: DEFAULT_FILTERS } : null
  )
  const [mode, setMode] = useState<Mode>('browse')

  const currentFiltersRef = useRef<BrowseFilters>(DEFAULT_FILTERS)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * The drafted set as of the last committed render, not the current one.
   * Results are filtered when a page lands and then left alone, so a movie
   * taken while the grid is open stays put and shows its "Drafted" overlay
   * instead of silently vanishing out from under the cursor.
   */
  const draftedAtFetchRef = useRef(draftedTmdbIds)
  useEffect(() => {
    draftedAtFetchRef.current = draftedTmdbIds
  }, [draftedTmdbIds])

  const getKey = useCallback(
    (index: number): PageKey | null => (request ? buildPageKey(request, index + 1) : null),
    [request]
  )

  const { data, error, isLoading, size, setSize } = useSWRInfinite(getKey, fetcher, {
    revalidateOnFocus: false,
    // Paging in more movies must not re-request the pages already on screen.
    revalidateFirstPage: false,
    dedupingInterval: LIST_TTL_MS,
    keepPreviousData: true,
  })

  const movies = useMemo(() => {
    const drafted = draftedAtFetchRef.current
    const seen = new Set<number>()
    const result: TMDbSearchResult[] = []

    for (const pageData of data ?? []) {
      for (const movie of pageData.results) {
        if (drafted.has(movie.tmdb_id) || seen.has(movie.tmdb_id)) continue
        seen.add(movie.tmdb_id)
        result.push(movie)
      }
    }
    return result
  }, [data])

  const lastPage = data && data.length > 0 ? data[data.length - 1] : undefined
  const page = lastPage?.page ?? 1
  const totalPages = lastPage?.total_pages ?? 0
  const totalResults = lastPage?.total_results ?? 0

  // A page has been requested that has not landed yet -- SWR's canonical
  // "loading more" check, and the only case where results already show.
  const loadingMore = size > 1 && data != null && data.length < size

  // `mode` describes what is on screen, so it only catches up once the request
  // it belongs to has actually resolved.
  useEffect(() => {
    if (!request || isLoading) return
    setMode(request.mode)
  }, [request, isLoading])

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const search = useCallback(
    (query: string) => {
      clearDebounce()

      if (!query.trim()) {
        setMode('browse')
        setRequest({ mode: 'browse', filters: currentFiltersRef.current })
        return
      }

      debounceRef.current = setTimeout(() => {
        setRequest({ mode: 'search', query: query.trim() })
      }, SEARCH_DEBOUNCE_MS)
    },
    [clearDebounce]
  )

  const browse = useCallback(
    (filters: BrowseFilters) => {
      currentFiltersRef.current = filters
      clearDebounce()

      debounceRef.current = setTimeout(() => {
        setRequest({ mode: 'browse', filters })
      }, SEARCH_DEBOUNCE_MS)
    },
    [clearDebounce]
  )

  const fetchTrending = useCallback(
    (trendingPage: number = 1, append: boolean = false) => {
      clearDebounce()
      setRequest({ mode: 'trending' })
      setSize(append ? trendingPage : 1)
    },
    [clearDebounce, setSize]
  )

  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return
    setSize((current) => current + 1)
  }, [loadingMore, page, totalPages, setSize])

  const clearSearch = useCallback(() => {
    setMode('browse')
    setRequest({ mode: 'browse', filters: currentFiltersRef.current })
  }, [])

  // A hook that starts disabled still fetches once its owner turns it on.
  const wasEnabledRef = useRef(enabled)
  useEffect(() => {
    if (!enabled || wasEnabledRef.current) {
      wasEnabledRef.current = enabled
      return
    }
    wasEnabledRef.current = enabled
    setRequest({ mode: 'browse', filters: currentFiltersRef.current })
  }, [enabled])

  useEffect(() => clearDebounce, [clearDebounce])

  return {
    movies,
    loading: isLoading,
    loadingMore,
    error: error?.message ?? null,
    page,
    totalPages,
    totalResults,
    mode,
    search,
    browse,
    fetchTrending,
    loadMore,
    clearSearch,
  }
}
