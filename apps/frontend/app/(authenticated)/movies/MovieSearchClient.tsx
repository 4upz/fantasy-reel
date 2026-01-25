'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Clapperboard, Search } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useScrollPosition } from '@/hooks/useScrollPosition'
import { useDebounce } from '@/hooks/useDebounce'
import { useMovieSearch } from '@/hooks/useMovieSearch'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'
import MovieSearchBar from './components/MovieSearchBar'
import MovieFilters from './components/MovieFilters'
import MovieGrid from './components/MovieGrid'
import MovieGridSkeleton from './components/MovieGridSkeleton'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const MovieDetailModal = dynamic(() => import('./components/MovieDetailModal'), {
  loading: () => <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"><div className="fixed inset-0 bg-black/85" /><div className="relative z-10 w-full max-w-4xl mx-4 my-8 sm:my-12 animate-pulse h-[600px] bg-surface rounded-lg" /></div>,
})

export default function MovieSearchClient(): React.ReactElement {
  // Input state (controlled by both search bars)
  const [inputValue, setInputValue] = useState('')
  const [year, setYear] = useState<number | null>(null)

  // Debounce the input value - single source of truth for search
  const debouncedQuery = useDebounce(inputValue, 300)

  // SWR-powered search with automatic request deduplication
  const {
    results,
    loading,
    loadingMore,
    error,
    totalResults,
    hasMore,
    loadMore,
  } = useMovieSearch(debouncedQuery, { year })

  // Movie detail modal state
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [movieDetails, setMovieDetails] = useState<TMDbMovieDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  function handleInputChange(value: string): void {
    setInputValue(value)
    if (value && results.length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  function handleClear(): void {
    setInputValue('')
  }

  async function handleMovieClick(movie: TMDbSearchResult): Promise<void> {
    setSelectedMovie(movie)
    setLoadingDetails(true)
    setMovieDetails(null)

    const { data, error: detailError } = await callEdgeFunction<TMDbMovieDetails>(
      'get-movie-details',
      { body: { tmdb_id: movie.tmdb_id } }
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
  const showEmptyState = !loading && debouncedQuery && !hasResults && !error
  const showInitialState = !loading && !debouncedQuery && !hasResults

  const sentinelRef = useInfiniteScroll({
    hasMore,
    isLoading: loading || loadingMore,
    onLoadMore: loadMore,
  })

  const isScrolled = useScrollPosition({ threshold: 200 })

  return (
    <div className="min-h-screen">
      <div className={`search-bar-floating ${isScrolled ? 'visible' : ''}`}>
        <div className="max-w-3xl mx-auto px-4">
          <MovieSearchBar
            value={inputValue}
            onChange={handleInputChange}
            onClear={handleClear}
            loading={loading}
            compact
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
            <MovieSearchBar
              value={inputValue}
              onChange={handleInputChange}
              onClear={handleClear}
              loading={loading}
            />
          </div>
        </div>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(hasResults || debouncedQuery) && (
          <div className="mb-8 animate-fade-in">
            <MovieFilters
              year={year}
              onYearChange={setYear}
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
              No movies found for &ldquo;{debouncedQuery}&rdquo;
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
