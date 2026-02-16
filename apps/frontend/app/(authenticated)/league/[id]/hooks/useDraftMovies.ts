import { useState, useCallback, useRef, useEffect } from 'react'
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

interface UseDraftMoviesOptions {
  draftedTmdbIds: Set<number>
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

export function useDraftMovies({ draftedTmdbIds }: UseDraftMoviesOptions): UseDraftMoviesReturn {
  const [movies, setMovies] = useState<TMDbSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalResults, setTotalResults] = useState(0)
  const [mode, setMode] = useState<Mode>('browse')

  const currentQueryRef = useRef<string>('')
  const currentFiltersRef = useRef<BrowseFilters>({
    releaseWindow: 'year',
    genres: [],
    minRating: 0,
  })
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const filterDrafted = useCallback(
    (results: TMDbSearchResult[]): TMDbSearchResult[] => {
      return results.filter((m) => !draftedTmdbIds.has(m.tmdb_id))
    },
    [draftedTmdbIds]
  )

  function appendDeduped(
    prev: TMDbSearchResult[],
    newItems: TMDbSearchResult[]
  ): TMDbSearchResult[] {
    const existingIds = new Set(prev.map((m) => m.tmdb_id))
    const unique = newItems.filter((m) => !existingIds.has(m.tmdb_id))
    return [...prev, ...unique]
  }

  // Shared fetch logic for all three modes
  const fetchMovies = useCallback(
    async <T extends PaginatedResponse>(
      functionName: string,
      body: Record<string, unknown>,
      targetMode: Mode,
      append: boolean
    ): Promise<void> => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }

      const { data, error: apiError } = await callEdgeFunction<T>(functionName, { body })

      if (apiError) {
        setError(apiError)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      if (data) {
        const filtered = filterDrafted(data.results)
        if (append) {
          setMovies((prev) => appendDeduped(prev, filtered))
        } else {
          setMovies(filtered)
        }
        setPage(data.page)
        setTotalPages(data.total_pages)
        setTotalResults(data.total_results)
        setMode(targetMode)
      }

      setLoading(false)
      setLoadingMore(false)
    },
    [filterDrafted]
  )

  const searchMovies = useCallback(
    async (query: string, searchPage: number = 1, append: boolean = false) => {
      if (!query.trim()) return

      await fetchMovies<TMDbSearchResponse>(
        'search-movies',
        { query: query.trim(), page: searchPage },
        'search',
        append
      )
    },
    [fetchMovies]
  )

  const browseMovies = useCallback(
    async (filters: BrowseFilters, browsePage: number = 1, append: boolean = false) => {
      await fetchMovies<BrowseResponse>(
        'browse-movies',
        {
          page: browsePage,
          release_window: filters.releaseWindow,
          genres: filters.genres.length > 0 ? filters.genres : undefined,
          min_rating: filters.minRating > 0 ? filters.minRating : undefined,
          sort_by: 'popularity',
        },
        'browse',
        append
      )
    },
    [fetchMovies]
  )

  const fetchTrending = useCallback(
    async (trendingPage: number = 1, append: boolean = false) => {
      await fetchMovies<BrowseResponse>(
        'browse-movies',
        { page: trendingPage, trending: true },
        'trending',
        append
      )
    },
    [fetchMovies]
  )

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const search = useCallback(
    (query: string) => {
      clearDebounce()
      currentQueryRef.current = query

      if (!query.trim()) {
        setMode('browse')
        browseMovies(currentFiltersRef.current, 1)
        return
      }

      debounceRef.current = setTimeout(() => {
        searchMovies(query, 1)
      }, 300)
    },
    [searchMovies, browseMovies, clearDebounce]
  )

  const browse = useCallback(
    (filters: BrowseFilters) => {
      currentFiltersRef.current = filters
      currentQueryRef.current = ''
      clearDebounce()

      debounceRef.current = setTimeout(() => {
        browseMovies(filters, 1)
      }, 300)
    },
    [browseMovies, clearDebounce]
  )

  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return

    const nextPage = page + 1
    if (mode === 'trending') {
      fetchTrending(nextPage, true)
    } else if (mode === 'search' && currentQueryRef.current) {
      searchMovies(currentQueryRef.current, nextPage, true)
    } else {
      browseMovies(currentFiltersRef.current, nextPage, true)
    }
  }, [mode, page, totalPages, loadingMore, fetchTrending, searchMovies, browseMovies])

  const clearSearch = useCallback(() => {
    currentQueryRef.current = ''
    setMode('browse')
    browseMovies(currentFiltersRef.current, 1)
  }, [browseMovies])

  useEffect(() => {
    browseMovies(currentFiltersRef.current, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return clearDebounce
  }, [clearDebounce])

  return {
    movies,
    loading,
    loadingMore,
    error,
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
