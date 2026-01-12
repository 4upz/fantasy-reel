'use client'

import { useState, useCallback } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { TMDbSearchResult, TMDbSearchResponse, TMDbMovieDetails } from '@/types'
import MovieSearchBar from './components/MovieSearchBar'
import MovieFilters from './components/MovieFilters'
import MovieGrid from './components/MovieGrid'
import MovieDetailModal from './components/MovieDetailModal'

export default function MovieSearchClient() {
  const [results, setResults] = useState<TMDbSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalResults, setTotalResults] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  // Filters
  const [year, setYear] = useState<number | null>(null)

  // Selected movie for detail modal
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
          setResults((prev) => [...prev, ...data.results])
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
      searchMovies(newQuery, 1)
    },
    [searchMovies]
  )

  const handleLoadMore = () => {
    if (page < totalPages) {
      searchMovies(query, page + 1, true)
    }
  }

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

  const handleCloseModal = () => {
    setSelectedMovie(null)
    setMovieDetails(null)
  }

  const hasResults = results.length > 0
  const showEmptyState = !loading && query && !hasResults && !error
  const showInitialState = !loading && !query && !hasResults

  return (
    <div className="min-h-screen">
      {/* Hero header with film grain texture */}
      <div className="relative overflow-hidden border-b border-border bg-gradient-to-b from-surface to-background">
        {/* Subtle film grain overlay */}
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

          {/* Search bar */}
          <div className="max-w-2xl mx-auto">
            <MovieSearchBar onSearch={handleSearch} loading={loading} />
          </div>
        </div>

        {/* Decorative gold line */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters row - only show when we have results or a query */}
        {(hasResults || query) && (
          <div className="mb-8 animate-fade-in">
            <MovieFilters
              year={year}
              onYearChange={handleYearChange}
              totalResults={totalResults}
            />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="alert alert-error mb-6 animate-fade-in">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {/* Initial state - show when no search yet */}
        {showInitialState && (
          <div className="text-center py-20 animate-fade-in">
            <div className="text-6xl mb-4">🎬</div>
            <p className="text-foreground-secondary text-lg">
              Start typing to search for movies
            </p>
          </div>
        )}

        {/* Empty state */}
        {showEmptyState && (
          <div className="text-center py-20 animate-fade-in">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-foreground-secondary text-lg">
              No movies found for &ldquo;{query}&rdquo;
            </p>
            <p className="text-foreground-muted mt-2">Try a different search term</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              <p className="text-foreground-secondary">Searching movies...</p>
            </div>
          </div>
        )}

        {/* Results grid */}
        {!loading && hasResults && (
          <>
            <MovieGrid movies={results} onMovieClick={handleMovieClick} />

            {/* Load more button */}
            {page < totalPages && (
              <div className="mt-12 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="btn btn-secondary px-8 py-3"
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      Loading...
                    </span>
                  ) : (
                    `Load More (${page} of ${totalPages})`
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Movie detail modal */}
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
