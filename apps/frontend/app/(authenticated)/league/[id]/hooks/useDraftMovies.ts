import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import { edgeFetcher } from '@/utils/supabase/functions'
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
 * SWR key for one page of one request: the function to call and the body to
 * call it with. SWR hashes the body stably (keys sorted, `undefined` dropped),
 * so two equivalent requests share one cache entry.
 */
type PageKey = [functionName: string, body: Record<string, unknown>]

function buildPageKey(request: Request, page: number): PageKey {
  switch (request.mode) {
    case 'search':
      return ['search-movies', { query: request.query, page, upcoming_only: true }]
    case 'trending':
      return ['browse-movies', { page, trending: true }]
    case 'browse':
      return [
        'browse-movies',
        {
          page,
          release_window: request.filters.releaseWindow,
          genres: request.filters.genres.length > 0 ? request.filters.genres : undefined,
          min_rating: request.filters.minRating > 0 ? request.filters.minRating : undefined,
          sort_by: 'popularity',
        },
      ]
  }
}

const fetcher = ([functionName, body]: PageKey): Promise<PaginatedResponse> =>
  edgeFetcher<PaginatedResponse>(functionName, body)

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
  totalResults: number
  mode: Mode
  search: (query: string) => void
  browse: (filters: BrowseFilters) => void
  fetchTrending: () => void
  loadMore: () => void
  clearSearch: () => void
}

export function useDraftMovies({ draftedTmdbIds, enabled = true }: UseDraftMoviesOptions): UseDraftMoviesReturn {
  const [request, setRequest] = useState<Request>({ mode: 'browse', filters: DEFAULT_FILTERS })

  const currentFiltersRef = useRef<BrowseFilters>(DEFAULT_FILTERS)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // A null key is SWR's "don't fetch": a hook that starts disabled sits idle
  // and fetches the moment its owner turns it on.
  const getKey = useCallback(
    (index: number): PageKey | null => (enabled ? buildPageKey(request, index + 1) : null),
    [enabled, request]
  )

  const { data, error, isLoading, size, setSize } = useSWRInfinite(getKey, fetcher, {
    // Paging in more movies must not re-request the pages already on screen.
    revalidateFirstPage: false,
    // Keys depend on the page index alone, never on the previous page, so
    // pages can be revalidated concurrently instead of one after another.
    parallel: true,
    keepPreviousData: true,
  })

  const movies = useMemo(() => {
    /*
     * The drafted set is read here but deliberately left out of the deps:
     * results are filtered when a page lands and then left alone, so a movie
     * taken while the grid is open stays put and shows its "Drafted" overlay
     * instead of silently vanishing out from under the cursor.
     */
    const seen = new Set<number>()
    const result: TMDbSearchResult[] = []

    for (const pageData of data ?? []) {
      for (const movie of pageData.results) {
        if (draftedTmdbIds.has(movie.tmdb_id) || seen.has(movie.tmdb_id)) continue
        seen.add(movie.tmdb_id)
        result.push(movie)
      }
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const lastPage = data && data.length > 0 ? data[data.length - 1] : undefined
  const page = lastPage?.page ?? 1
  const totalPages = lastPage?.total_pages ?? 0

  // A page has been requested that has not landed yet -- SWR's canonical
  // "loading more" check, and the only case where results already show.
  const loadingMore = size > 1 && data != null && data.length < size

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  /** Switch to a different list, always starting from its first page. */
  const changeRequest = useCallback(
    (next: Request) => {
      clearDebounce()
      setRequest(next)
      setSize(1)
    },
    [clearDebounce, setSize]
  )

  const search = useCallback(
    (query: string) => {
      clearDebounce()

      const trimmed = query.trim()
      if (!trimmed) {
        changeRequest({ mode: 'browse', filters: currentFiltersRef.current })
        return
      }

      debounceRef.current = setTimeout(() => {
        changeRequest({ mode: 'search', query: trimmed })
      }, SEARCH_DEBOUNCE_MS)
    },
    [changeRequest, clearDebounce]
  )

  const browse = useCallback(
    (filters: BrowseFilters) => {
      currentFiltersRef.current = filters
      clearDebounce()

      debounceRef.current = setTimeout(() => {
        changeRequest({ mode: 'browse', filters })
      }, SEARCH_DEBOUNCE_MS)
    },
    [changeRequest, clearDebounce]
  )

  const fetchTrending = useCallback(() => {
    changeRequest({ mode: 'trending' })
  }, [changeRequest])

  const clearSearch = useCallback(() => {
    search('')
  }, [search])

  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return
    setSize((current) => current + 1)
  }, [loadingMore, page, totalPages, setSize])

  useEffect(() => clearDebounce, [clearDebounce])

  return {
    movies,
    loading: isLoading,
    loadingMore,
    error: error?.message ?? null,
    totalResults: lastPage?.total_results ?? 0,
    mode: request.mode,
    search,
    browse,
    fetchTrending,
    loadMore,
    clearSearch,
  }
}
