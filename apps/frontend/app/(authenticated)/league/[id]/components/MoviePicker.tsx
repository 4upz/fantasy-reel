'use client'

import { useState, useCallback, useRef } from 'react'
import type { TMDbSearchResult } from '@/types'
import { useDraftMovies, type BrowseFilters } from '../hooks/useDraftMovies'
import DraftFilters from './DraftFilters'
import DraftMovieCard from './DraftMovieCard'
import MovieQuickPreview from './MovieQuickPreview'
import { SpinnerIcon } from './Icons'

interface Props {
  draftedTmdbIds: Set<number>
  favoriteMovieIds?: Set<number>
  isMyTurn: boolean
  picking: boolean
  onPick: (tmdbId: number, movieData: TMDbSearchResult) => void
  onToggleFavorite?: (tmdbId: number) => void
}

type TabType = 'all' | 'trending' | 'releasing-soon' | 'favorites'

const TABS: { id: TabType; label: string; icon: string }[] = [
  { id: 'all', label: 'All Movies', icon: '🎬' },
  { id: 'trending', label: 'Trending', icon: '🔥' },
  { id: 'releasing-soon', label: 'Releasing Soon', icon: '📅' },
  { id: 'favorites', label: 'Favorites', icon: '❤️' },
]

export default function MoviePicker({
  draftedTmdbIds,
  favoriteMovieIds = new Set(),
  isMyTurn,
  picking,
  onPick,
  onToggleFavorite,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [previewMovie, setPreviewMovie] = useState<TMDbSearchResult | null>(null)
  const {
    movies,
    loading,
    loadingMore,
    error,
    totalResults,
    mode,
    search,
    browse,
    loadMore,
  } = useDraftMovies({ draftedTmdbIds })

  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || loadingMore) return
      if (observerRef.current) observerRef.current.disconnect()

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      })

      if (node) observerRef.current.observe(node)
    },
    [loading, loadingMore, loadMore]
  )

  // Apply tab-specific filtering
  const getFilteredMovies = useCallback(() => {
    let result = movies

    switch (activeTab) {
      case 'trending':
        result = result.filter((m) => (m.popularity || 0) >= 50)
        break
      case 'releasing-soon':
        result = result.filter((m) => {
          if (!m.release_date) return false
          const releaseDate = new Date(m.release_date)
          const now = new Date()
          const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
          return releaseDate >= now && releaseDate <= thirtyDaysFromNow
        })
        break
      case 'favorites':
        result = result.filter((m) => favoriteMovieIds.has(m.tmdb_id))
        break
    }

    return result
  }, [movies, activeTab, favoriteMovieIds])

  const filteredMovies = getFilteredMovies()

  // Handle filter changes (when not searching)
  const handleFiltersChange = useCallback(
    (newFilters: BrowseFilters & { search: string }) => {
      const { search: searchValue, ...browseFilters } = newFilters

      if (searchValue !== searchQuery) {
        setSearchQuery(searchValue)
        if (searchValue) {
          search(searchValue)
        } else {
          browse(browseFilters)
        }
      } else if (!searchValue) {
        browse(browseFilters)
      }
    },
    [browse, search, searchQuery]
  )

  const handleSelectMovie = (movie: TMDbSearchResult) => {
    if (draftedTmdbIds.has(movie.tmdb_id)) return
    setSelectedMovie(movie)
  }

  const handleConfirmPick = () => {
    if (selectedMovie && isMyTurn) {
      onPick(selectedMovie.tmdb_id, selectedMovie)
      setSelectedMovie(null)
    }
  }

  const handlePreview = (movie: TMDbSearchResult) => {
    setPreviewMovie(movie)
  }

  const handleDraftFromPreview = (tmdbId: number) => {
    const movie = movies.find((m) => m.tmdb_id === tmdbId)
    if (movie) {
      onPick(tmdbId, movie)
    }
    setPreviewMovie(null)
    setSelectedMovie(null)
  }

  const handleToggleFavorite = useCallback(
    (tmdbId: number) => {
      onToggleFavorite?.(tmdbId)
    },
    [onToggleFavorite]
  )

  // Count available (non-drafted) movies
  const availableCount = filteredMovies.filter((m) => !draftedTmdbIds.has(m.tmdb_id)).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-display font-semibold text-foreground">
          {isMyTurn ? 'Select Your Movie' : 'Browse Movies'}
        </h3>
        {isMyTurn && (
          <span className="badge bg-success-bg text-success border border-success">
            Your Turn
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-elevated rounded-xl overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-gold text-background shadow-md'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.id === 'favorites' && favoriteMovieIds.size > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === tab.id ? 'bg-background/20 text-background' : 'bg-crimson text-white'
                }`}
              >
                {favoriteMovieIds.size}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <DraftFilters
        onFiltersChange={handleFiltersChange}
        totalResults={mode === 'search' ? totalResults : availableCount}
        loading={loading}
      />

      {/* Error State */}
      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && movies.length === 0 && (
        <div className="text-center py-12">
          <SpinnerIcon className="w-8 h-8 text-gold mx-auto animate-spin" />
          <p className="text-foreground-secondary mt-3">Loading movies...</p>
        </div>
      )}

      {/* Movie Grid */}
      {!loading && filteredMovies.length === 0 ? (
        <div className="text-center py-12 bg-elevated rounded-xl border border-border">
          <div className="text-4xl mb-3">
            {activeTab === 'favorites' ? '❤️' : mode === 'search' ? '🔍' : '🎬'}
          </div>
          <p className="text-foreground-secondary">
            {activeTab === 'favorites'
              ? 'No favorites yet. Heart movies to add them here!'
              : mode === 'search'
              ? 'No movies found for your search'
              : 'No movies match your filters'}
          </p>
          {activeTab !== 'all' && (
            <button
              onClick={() => setActiveTab('all')}
              className="mt-3 text-sm text-gold hover:text-gold-hover transition-colors"
            >
              View all movies
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredMovies.map((movie) => (
              <DraftMovieCard
                key={movie.tmdb_id}
                movie={movie}
                isSelected={selectedMovie?.tmdb_id === movie.tmdb_id}
                isFavorite={favoriteMovieIds.has(movie.tmdb_id)}
                isDrafted={draftedTmdbIds.has(movie.tmdb_id)}
                onSelect={handleSelectMovie}
                onToggleFavorite={handleToggleFavorite}
                onPreview={handlePreview}
              />
            ))}
          </div>

          {/* Load More Trigger */}
          {!loading && movies.length > 0 && (
            <div ref={loadMoreRef} className="h-4" />
          )}

          {/* Loading More Indicator */}
          {loadingMore && (
            <div className="text-center py-4">
              <SpinnerIcon className="w-6 h-6 text-gold mx-auto animate-spin" />
            </div>
          )}
        </>
      )}

      {/* Selection Confirmation */}
      {selectedMovie && isMyTurn && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface/95 backdrop-blur-md border-t border-border shadow-heavy z-40 animate-slide-up">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
              {/* Selected movie preview */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {selectedMovie.poster_url && (
                  <img
                    src={selectedMovie.poster_url}
                    alt={selectedMovie.title}
                    className="w-12 h-18 object-cover rounded-lg border border-border"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{selectedMovie.title}</p>
                  <p className="text-sm text-foreground-muted">
                    {selectedMovie.release_date
                      ? new Date(selectedMovie.release_date).toLocaleDateString()
                      : 'TBA'}
                    {selectedMovie.vote_average > 0 && (
                      <span className="ml-2">
                        <span className="text-gold">★</span> {selectedMovie.vote_average.toFixed(1)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedMovie(null)}
                  disabled={picking}
                  className="btn btn-ghost px-4"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPick}
                  disabled={picking}
                  className="btn btn-primary px-6"
                >
                  {picking ? (
                    <span className="flex items-center gap-2">
                      <SpinnerIcon className="w-4 h-4" />
                      Drafting...
                    </span>
                  ) : (
                    'Confirm Pick'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Preview Modal */}
      {previewMovie && (
        <MovieQuickPreview
          movie={previewMovie}
          isMyTurn={isMyTurn}
          isFavorite={favoriteMovieIds.has(previewMovie.tmdb_id)}
          onClose={() => setPreviewMovie(null)}
          onDraft={handleDraftFromPreview}
          onToggleFavorite={handleToggleFavorite}
          picking={picking}
        />
      )}
    </div>
  )
}
