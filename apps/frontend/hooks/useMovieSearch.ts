import useSWR from 'swr'
import { useCallback, useState, useEffect, useRef } from 'react'
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
  totalPages: number
  page: number
  hasMore: boolean
  loadMore: () => void
  query: string
}

type FetcherKey = ['search-movies', string, number, number | null | undefined]

const fetcher = ([, q, p, y]: FetcherKey): Promise<TMDbSearchResponse> =>
  edgeFetcher<TMDbSearchResponse>('search-movies', {
    query: q,
    page: p,
    upcoming_only: false,
    ...(y && { year: y }),
  })

/**
 * SWR-powered movie search hook with automatic request deduplication.
 *
 * Uses SWR's built-in deduplication to prevent duplicate API calls when
 * multiple components trigger searches with the same parameters.
 *
 * @param debouncedQuery - The debounced search query (debounce in parent)
 * @param options - Optional year filter
 */
export function useMovieSearch(
  debouncedQuery: string,
  options: UseMovieSearchOptions = {}
): UseMovieSearchReturn {
  const { year } = options
  const [page, setPage] = useState(1)
  const [allResults, setAllResults] = useState<TMDbSearchResult[]>([])
  const [totalResults, setTotalResults] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const previousQueryRef = useRef(debouncedQuery)
  const previousYearRef = useRef(year)

  // Reset pagination when query or year changes
  useEffect(() => {
    const queryChanged = debouncedQuery !== previousQueryRef.current
    const yearChanged = year !== previousYearRef.current

    if (queryChanged || yearChanged) {
      setPage(1)
      setAllResults([])
      setTotalResults(0)
      setTotalPages(0)
      previousQueryRef.current = debouncedQuery
      previousYearRef.current = year
    }
  }, [debouncedQuery, year])

  // SWR key includes query, page, year - dedupes identical requests
  const trimmedQuery = debouncedQuery.trim()
  const swrKey: FetcherKey | null = trimmedQuery
    ? ['search-movies', trimmedQuery, page, year]
    : null

  const { data, error, isLoading, isValidating } = useSWR(swrKey, fetcher, {
    keepPreviousData: true, // Keep showing previous data while loading new page
  })

  // Accumulate results for pagination when new data arrives
  useEffect(() => {
    if (data) {
      setTotalResults(data.total_results)
      setTotalPages(data.total_pages)

      if (page === 1) {
        setAllResults(data.results)
      } else {
        // Append new results, avoiding duplicates
        setAllResults((prev) => {
          const existingIds = new Set(prev.map((m) => m.tmdb_id))
          const newResults = data.results.filter((m) => !existingIds.has(m.tmdb_id))
          return [...prev, ...newResults]
        })
      }
    }
  }, [data, page])

  const loadMore = useCallback(() => {
    if (data && page < data.total_pages && !isLoading && !isValidating) {
      setPage((p) => p + 1)
    }
  }, [data, page, isLoading, isValidating])

  const hasMore = page < totalPages

  return {
    results: allResults,
    loading: isLoading && page === 1,
    loadingMore: (isLoading || isValidating) && page > 1,
    error: error?.message || null,
    totalResults,
    totalPages,
    page,
    hasMore,
    loadMore,
    query: debouncedQuery,
  }
}
