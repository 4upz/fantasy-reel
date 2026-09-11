import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import { useDebounce } from '@/hooks/useDebounce'
import { flattenMoviePages, MOVIE_PAGE_SWR_CONFIG, type MoviePageKey } from '@/utils/movies'
import { edgeFetcher } from '@/utils/supabase/functions'
import type { TMDbSearchResponse } from '@/types'

export interface BrowseFilters {
  releaseWindow: 'next30' | 'quarter' | 'year' | 'all'
  genres: number[]
}

export type DraftMovieRequest =
  | { mode: 'browse'; filters: BrowseFilters }
  | { mode: 'search'; query: string }
  | { mode: 'trending' }

const DEFAULT_FILTERS: BrowseFilters = { releaseWindow: 'year', genres: [] }
const MAX_AUTOMATIC_PAGES = 3

function buildPageKey(request: DraftMovieRequest, page: number, seasonYear?: number): MoviePageKey {
  switch (request.mode) {
    case 'search':
      return ['search-movies', { query: request.query, page, upcoming_only: true, season_year: seasonYear }]
    case 'trending':
      return ['browse-movies', { page, trending: true, season_year: seasonYear }]
    case 'browse':
      return ['browse-movies', {
        page, release_window: request.filters.releaseWindow,
        genres: request.filters.genres.length ? request.filters.genres : undefined,
        sort_by: 'popularity', season_year: seasonYear,
      }]
  }
}

const fetcher = ([functionName, body]: MoviePageKey) => edgeFetcher<TMDbSearchResponse>(functionName, body)

interface Options {
  draftedTmdbIds: Set<number>
  seasonYear?: number
  enabled?: boolean
  /** Controlled by the draft picker. Other consumers can use search/browse. */
  request?: DraftMovieRequest
}

export function useDraftMovies({ draftedTmdbIds, seasonYear, enabled = true, request: controlledRequest }: Options) {
  const [internalRequest, setInternalRequest] = useState<DraftMovieRequest>({ mode: 'browse', filters: DEFAULT_FILTERS })
  const currentFiltersRef = useRef(DEFAULT_FILTERS)
  const request = controlledRequest ?? internalRequest
  const debouncedRequest = useDebounce(request, 300)
  const changingRequest = request !== debouncedRequest
  const getKey = useCallback((index: number): MoviePageKey | null => (
    enabled ? buildPageKey(debouncedRequest, index + 1, seasonYear) : null
  ), [enabled, debouncedRequest, seasonYear])

  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite(getKey, fetcher, {
    ...MOVIE_PAGE_SWR_CONFIG,
    // A filter change must never label the previous request's movies as matches.
    keepPreviousData: false,
    persistSize: false,
    shouldRetryOnError: false,
  })

  // Keep newly drafted cards in place with their Drafted overlay. Exclusions
  // apply when a page arrives, not while another player is using the grid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const movies = useMemo(() => enabled && !changingRequest ? flattenMoviePages(data, draftedTmdbIds) : [], [data, enabled, changingRequest])
  const lastPage = data?.[data.length - 1]
  const hasMore = enabled && !changingRequest && Boolean(lastPage && (
    lastPage.has_more ?? lastPage.page < lastPage.total_pages
  ))
  const loading = enabled && (changingRequest || isLoading)
  const loadingMore = enabled && !error && size > 1 && data !== undefined && data.length < size

  const loadMore = useCallback(() => {
    if (loading || loadingMore || error || !hasMore) return
    // Repeated clicks/intersections cannot skip past a pending page.
    void setSize(current => current === data?.length ? current + 1 : current).catch(() => { /* SWR exposes the error for retry. */ })
  }, [loading, loadingMore, error, hasMore, data?.length, setSize])

  useEffect(() => {
    if (!loading && !loadingMore && !error && hasMore && movies.length === 0 && size < MAX_AUTOMATIC_PAGES) {
      loadMore()
    }
  }, [loading, loadingMore, error, hasMore, movies.length, size, loadMore])

  const search = useCallback((query: string) => {
    const trimmed = query.trim()
    setInternalRequest(trimmed ? { mode: 'search', query: trimmed } : { mode: 'browse', filters: currentFiltersRef.current })
  }, [])
  const browse = useCallback((filters: BrowseFilters) => {
    currentFiltersRef.current = filters
    setInternalRequest({ mode: 'browse', filters })
  }, [])
  const fetchTrending = useCallback(() => setInternalRequest({ mode: 'trending' }), [])
  const clearSearch = useCallback(() => search(''), [search])
  const retry = useCallback(() => { void mutate().catch(() => { /* Keep the retry error in SWR's visible state. */ }) }, [mutate])

  return {
    movies, loading, loadingMore, error: changingRequest ? null : error?.message ?? null,
    totalResults: lastPage?.total_results ?? 0, hasMore,
    mode: request.mode, search, browse, fetchTrending, loadMore, clearSearch, retry,
  }
}
