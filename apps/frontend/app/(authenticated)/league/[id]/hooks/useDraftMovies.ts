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
  mode: 'browse' | 'search'
  search: (query: string) => void
  browse: (filters: BrowseFilters) => void
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
  const [mode, setMode] = useState<'browse' | 'search'>('browse')

  // Track current query/filters for pagination
  const currentQueryRef = useRef<string>('')
  const currentFiltersRef = useRef<BrowseFilters>({
    releaseWindow: 'year',
    genres: [],
    minRating: 0,
  })
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Filter out drafted movies from results
  const filterDrafted = useCallback(
    (results: TMDbSearchResult[]) => {
      return results.filter((m) => !draftedTmdbIds.has(m.tmdb_id))
    },
    [draftedTmdbIds]
  )

  // Search movies via TMDb API
  const searchMovies = useCallback(
    async (query: string, searchPage: number = 1, append: boolean = false) => {
      if (!query.trim()) {
        // If search is cleared, go back to browse mode
        return
      }

      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }

      const { data, error: apiError } = await callEdgeFunction<TMDbSearchResponse>(
        'search-movies',
        {
          body: {
            query: query.trim(),
            page: searchPage,
          },
        }
      )

      if (apiError) {
        setError(apiError)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      if (data) {
        const filteredResults = filterDrafted(data.results)
        if (append) {
          setMovies((prev) => {
            const existingIds = new Set(prev.map((m) => m.tmdb_id))
            const newResults = filteredResults.filter((m) => !existingIds.has(m.tmdb_id))
            return [...prev, ...newResults]
          })
        } else {
          setMovies(filteredResults)
        }
        setPage(data.page)
        setTotalPages(data.total_pages)
        setTotalResults(data.total_results)
        setMode('search')
      }

      setLoading(false)
      setLoadingMore(false)
    },
    [filterDrafted]
  )

  // Browse movies via TMDb discover API
  const browseMovies = useCallback(
    async (filters: BrowseFilters, browsePage: number = 1, append: boolean = false) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }

      const { data, error: apiError } = await callEdgeFunction<BrowseResponse>(
        'browse-movies',
        {
          body: {
            page: browsePage,
            release_window: filters.releaseWindow,
            genres: filters.genres.length > 0 ? filters.genres : undefined,
            min_rating: filters.minRating > 0 ? filters.minRating : undefined,
            sort_by: 'popularity',
          },
        }
      )

      if (apiError) {
        setError(apiError)
        setLoading(false)
        setLoadingMore(false)
        return
      }

      if (data) {
        const filteredResults = filterDrafted(data.results)
        if (append) {
          setMovies((prev) => {
            const existingIds = new Set(prev.map((m) => m.tmdb_id))
            const newResults = filteredResults.filter((m) => !existingIds.has(m.tmdb_id))
            return [...prev, ...newResults]
          })
        } else {
          setMovies(filteredResults)
        }
        setPage(data.page)
        setTotalPages(data.total_pages)
        setTotalResults(data.total_results)
        setMode('browse')
      }

      setLoading(false)
      setLoadingMore(false)
    },
    [filterDrafted]
  )

  // Debounced search handler
  const search = useCallback(
    (query: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      currentQueryRef.current = query

      if (!query.trim()) {
        // Clear search, trigger browse with current filters
        setMode('browse')
        browseMovies(currentFiltersRef.current, 1)
        return
      }

      debounceRef.current = setTimeout(() => {
        searchMovies(query, 1)
      }, 300)
    },
    [searchMovies, browseMovies]
  )

  // Browse with filters
  const browse = useCallback(
    (filters: BrowseFilters) => {
      currentFiltersRef.current = filters
      currentQueryRef.current = ''

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        browseMovies(filters, 1)
      }, 300)
    },
    [browseMovies]
  )

  // Load more results
  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return

    if (mode === 'search' && currentQueryRef.current) {
      searchMovies(currentQueryRef.current, page + 1, true)
    } else {
      browseMovies(currentFiltersRef.current, page + 1, true)
    }
  }, [mode, page, totalPages, loadingMore, searchMovies, browseMovies])

  // Clear search and return to browse
  const clearSearch = useCallback(() => {
    currentQueryRef.current = ''
    setMode('browse')
    browseMovies(currentFiltersRef.current, 1)
  }, [browseMovies])

  // Initial load - browse with default filters
  useEffect(() => {
    browseMovies(currentFiltersRef.current, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

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
    loadMore,
    clearSearch,
  }
}
