import { useCallback, useMemo } from 'react'
import useSWRInfinite from 'swr/infinite'
import { flattenMoviePages, MOVIE_PAGE_SWR_CONFIG, type MoviePageKey } from '@/utils/movies'
import { edgeFetcher } from '@/utils/supabase/functions'
import type { TMDbSearchResult, TMDbSearchResponse } from '@/types'

interface UseMovieSearchOptions {
  year?: number | null
}

interface UseMovieSearchReturn {
  results: TMDbSearchResult[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  totalResults: number
  hasMore: boolean
  loadMore: () => void
}

const fetcher = ([functionName, body]: MoviePageKey): Promise<TMDbSearchResponse> =>
  edgeFetcher<TMDbSearchResponse>(functionName, body)

/**
 * Paginated movie search, one `useSWRInfinite` cache entry per query+year.
 *
 * @param debouncedQuery - The debounced search query (debounce in the parent)
 * @param options - Optional year filter
 */
export function useMovieSearch(
  debouncedQuery: string,
  options: UseMovieSearchOptions = {}
): UseMovieSearchReturn {
  const { year } = options
  const query = debouncedQuery.trim()

  // A null key is SWR's "don't fetch": an empty search box sits idle.
  const getKey = useCallback(
    (index: number): MoviePageKey | null =>
      query
        ? [
            'search-movies',
            {
              query,
              page: index + 1,
              upcoming_only: false,
              year: year || undefined,
            },
          ]
        : null,
    [query, year]
  )

  const { data, error, isLoading, size, setSize } = useSWRInfinite(getKey, fetcher, MOVIE_PAGE_SWR_CONFIG)

  /*
   * `keepPreviousData` is what keeps the old grid on screen while the next
   * query loads instead of flashing empty. SWR also serves that carried-over
   * data under a null key, though, so an emptied search box has to drop it
   * explicitly -- otherwise clearing the box would leave its results behind.
   */
  const pages = query ? data : undefined

  const results = useMemo(() => flattenMoviePages(pages), [pages])

  const lastPage = pages && pages.length > 0 ? pages[pages.length - 1] : undefined
  const hasMore = lastPage !== undefined && lastPage.page < lastPage.total_pages

  // A page has been requested that has not landed yet -- SWR's canonical
  // "loading more" check, and the only case where results already show.
  const loadingMore = size > 1 && pages != null && pages.length < size

  const loadMore = useCallback(() => {
    if (isLoading || loadingMore || !hasMore) return
    setSize((current) => current + 1)
  }, [isLoading, loadingMore, hasMore, setSize])

  return {
    results,
    loading: isLoading,
    loadingMore,
    error: error?.message ?? null,
    totalResults: lastPage?.total_results ?? 0,
    hasMore,
    loadMore,
  }
}
