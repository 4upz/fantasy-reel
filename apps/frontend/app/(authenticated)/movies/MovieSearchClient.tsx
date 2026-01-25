'use client'

import { useState, useCallback } from 'react'
import { Clapperboard, Search } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useScrollPosition } from '@/hooks/useScrollPosition'
import type { TMDbSearchResult, TMDbSearchResponse, TMDbMovieDetails } from '@/types'
import MovieSearchBar from './components/MovieSearchBar'
import MovieFilters from './components/MovieFilters'
import MovieGrid from './components/MovieGrid'
import MovieGridSkeleton from './components/MovieGridSkeleton'
import MovieDetailModal from './components/MovieDetailModal'

export default function MovieSearchClient(): React.ReactElement {
  const [results, setResults] = useState<TMDbSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalResults, setTotalResults] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [movieDetails, setMovieDetails] = useState<TMDbMovieDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const searchMovies = useCallback(
    async (searchQuery: string, searchPage: number = 1, append: boolean = false) => {
      if (!searchQuery.trim()) {
        setResults([])
        setTotalPages(0)
        setTotalResults(0)
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
            query: searchQuery,
            page: searchPage,
            upcoming_only: false,
            ...(year && { year }),
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
        if (append) {
          setResults((prev) => {
            const existingIds = new Set(prev.map((m) => m.tmdb_id))
            const newResults = data.results.filter((m) => !existingIds.has(m.tmdb_id))
            return [...prev, ...newResults]
          })
        } else {
          setResults(data.results)
        }
        setPage(data.page)
        setTotalPages(data.total_pages)
        setTotalResults(data.total_results)
      }

      setLoading(false)
      setLoadingMore(false)
    },
    [year]
  )

  const handleSearch = useCallback(
    (newQuery: string) => {
      setQuery(newQuery)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      searchMovies(newQuery, 1)
    },
    [searchMovies]
  )

  const handleYearChange = (newYear: number | null) => {
    setYear(newYear)
    if (query) {
      searchMovies(query, 1)
    }
  }

  const handleMovieClick = async (movie: TMDbSearchResult) => {
    setSelectedMovie(movie)
    setLoadingDetails(true)
    setMovieDetails(null)

    const { data, error: detailError } = await callEdgeFunction<TMDbMovieDetails>(
      'get-movie-details',
      {
        body: { tmdb_id: movie.tmdb_id },
      }
    )

    if (data && !detailError) {
      setMovieDetails(data)
    }
    setLoadingDetails(false)
  }

  function handleCloseModal(): void {
    setSelectedMovie(null)
    setMovieDetails(null)
  }

  const hasResults = results.length > 0
  const hasMore = page < totalPages
  const showEmptyState = !loading && query && !hasResults && !error
  const showInitialState = !loading && !query && !hasResults

  const sentinelRef = useInfiniteScroll({
    hasMore,
    isLoading: loading || loadingMore,
    onLoadMore: () => searchMovies(query, page + 1, true),
  })

  const isScrolled = useScrollPosition({ threshold: 200 })

  return (
    <div className="min-h-screen">
      <div className={`search-bar-floating ${isScrolled ? 'visible' : ''}`}>
        <div className="max-w-3xl mx-auto px-4">
          <MovieSearchBar
            onSearch={handleSearch}
            loading={loading}
            compact
            initialValue={query}
          />
        </div>
      </div>

      <div className="relative overflow-hidden border-b border-border bg-gradient-to-b from-surface to-background">
        <div
          className="absolute inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-foreground tracking-tight mb-3">
              Discover Movies
            </h1>
            <p className="text-foreground-secondary text-lg max-w-xl mx-auto">
              Search the world&apos;s largest movie database and find your next blockbuster picks
            </p>
          </div>

          <div className="max-w-2xl mx-auto">
            <MovieSearchBar onSearch={handleSearch} loading={loading} initialValue={query} />
          </div>
        </div>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(hasResults || query) && (
          <div className="mb-8 animate-fade-in">
            <MovieFilters
              year={year}
              onYearChange={handleYearChange}
              totalResults={totalResults}
            />
          </div>
        )}

        {error && (
          <div className="alert alert-error mb-6 animate-fade-in">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {showInitialState && (
          <div className="text-center py-20 animate-fade-in">
            <div className="flex justify-center mb-4">
              <Clapperboard className="w-16 h-16 text-foreground-muted" />
            </div>
            <p className="text-foreground-secondary text-lg">
              Start typing to search for movies
            </p>
          </div>
        )}

        {showEmptyState && (
          <div className="text-center py-20 animate-fade-in">
            <div className="flex justify-center mb-4">
              <Search className="w-16 h-16 text-foreground-muted" />
            </div>
            <p className="text-foreground-secondary text-lg">
              No movies found for &ldquo;{query}&rdquo;
            </p>
            <p className="text-foreground-muted mt-2">Try a different search term</p>
          </div>
        )}

        {loading && <MovieGridSkeleton count={12} />}

        {!loading && hasResults && (
          <>
            <MovieGrid movies={results} onMovieClick={handleMovieClick} />

            {loadingMore && (
              <div className="mt-4 sm:mt-6">
                <MovieGridSkeleton count={6} />
              </div>
            )}

            {hasMore && !loadingMore && (
              <div ref={sentinelRef} className="h-4" aria-hidden="true" />
            )}
          </>
        )}
      </div>

      {selectedMovie && (
        <MovieDetailModal
          movie={selectedMovie}
          details={movieDetails}
          loading={loadingDetails}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
