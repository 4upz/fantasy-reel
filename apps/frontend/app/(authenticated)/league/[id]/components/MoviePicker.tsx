'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Movie } from '@/types'
import DraftFilters, { type DraftFilters as DraftFiltersType } from './DraftFilters'
import DraftMovieCard from './DraftMovieCard'
import MovieQuickPreview from './MovieQuickPreview'
import { SpinnerIcon } from './Icons'
import { isWithinDays, isThisYear } from './utils'

interface Props {
  movies: Movie[]
  draftedMovieIds: Set<string>
  favoriteMovieIds?: Set<string>
  isMyTurn: boolean
  picking: boolean
  onPick: (movieId: string) => void
  onToggleFavorite?: (movieId: string) => void
}

type TabType = 'all' | 'trending' | 'releasing-soon' | 'favorites'

const TABS: { id: TabType; label: string; icon: string }[] = [
  { id: 'all', label: 'All Movies', icon: '🎬' },
  { id: 'trending', label: 'Trending', icon: '🔥' },
  { id: 'releasing-soon', label: 'Releasing Soon', icon: '📅' },
  { id: 'favorites', label: 'Favorites', icon: '❤️' },
]

function isInReleaseWindow(date: string | null, window: DraftFiltersType['releaseWindow']): boolean {
  if (!date || window === 'all') return true

  switch (window) {
    case 'next30':
      return isWithinDays(date, 30)
    case 'quarter':
      return isWithinDays(date, 90)
    case 'year':
      return isThisYear(date)
    default:
      return true
  }
}

export default function MoviePicker({
  movies,
  draftedMovieIds,
  favoriteMovieIds = new Set(),
  isMyTurn,
  picking,
  onPick,
  onToggleFavorite,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [filters, setFilters] = useState<DraftFiltersType>({
    releaseWindow: 'year',
    genres: [],
    minRating: 0,
    search: '',
  })
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [previewMovie, setPreviewMovie] = useState<Movie | null>(null)

  // Filter movies based on active tab and filters
  const filteredMovies = useMemo(() => {
    let result = movies.filter((m) => m.status === 'upcoming')

    // Tab-based filtering
    switch (activeTab) {
      case 'trending':
        result = result.filter((m) => (m.popularity || 0) >= 50)
        break
      case 'releasing-soon':
        result = result.filter((m) => isWithinDays(m.release_date, 30))
        break
      case 'favorites':
        result = result.filter((m) => favoriteMovieIds.has(m.id))
        break
    }

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      result = result.filter((m) => m.title.toLowerCase().includes(searchLower))
    }

    // Release window filter
    result = result.filter((m) => isInReleaseWindow(m.release_date, filters.releaseWindow))

    // Min rating filter
    if (filters.minRating > 0) {
      result = result.filter((m) => (m.vote_average || 0) >= filters.minRating)
    }

    // Sort by release date, then popularity
    result.sort((a, b) => {
      // Favorites and trending: sort by popularity
      if (activeTab === 'trending' || activeTab === 'favorites') {
        return (b.popularity || 0) - (a.popularity || 0)
      }
      // Releasing soon: sort by release date
      if (activeTab === 'releasing-soon') {
        const dateA = a.release_date ? new Date(a.release_date).getTime() : Infinity
        const dateB = b.release_date ? new Date(b.release_date).getTime() : Infinity
        return dateA - dateB
      }
      // All: sort by popularity
      return (b.popularity || 0) - (a.popularity || 0)
    })

    return result
  }, [movies, activeTab, filters, favoriteMovieIds])

  const handleFiltersChange = useCallback((newFilters: DraftFiltersType) => {
    setFilters(newFilters)
  }, [])

  const handleSelectMovie = (movie: Movie) => {
    if (draftedMovieIds.has(movie.id)) return
    setSelectedMovie(movie)
  }

  const handleConfirmPick = () => {
    if (selectedMovie && isMyTurn) {
      onPick(selectedMovie.id)
      setSelectedMovie(null)
    }
  }

  const handlePreview = (movie: Movie) => {
    setPreviewMovie(movie)
  }

  const handleDraftFromPreview = (movieId: string) => {
    onPick(movieId)
    setPreviewMovie(null)
    setSelectedMovie(null)
  }

  const availableCount = filteredMovies.filter((m) => !draftedMovieIds.has(m.id)).length

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
        totalResults={availableCount}
        loading={false}
      />

      {/* Movie Grid */}
      {filteredMovies.length === 0 ? (
        <div className="text-center py-12 bg-elevated rounded-xl border border-border">
          <div className="text-4xl mb-3">
            {activeTab === 'favorites' ? '❤️' : '🎬'}
          </div>
          <p className="text-foreground-secondary">
            {activeTab === 'favorites'
              ? 'No favorites yet. Heart movies to add them here!'
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredMovies.map((movie) => (
            <DraftMovieCard
              key={movie.id}
              movie={movie}
              isSelected={selectedMovie?.id === movie.id}
              isFavorite={favoriteMovieIds.has(movie.id)}
              isDrafted={draftedMovieIds.has(movie.id)}
              onSelect={handleSelectMovie}
              onToggleFavorite={onToggleFavorite}
              onPreview={handlePreview}
            />
          ))}
        </div>
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
                    {selectedMovie.vote_average && (
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
          isFavorite={favoriteMovieIds.has(previewMovie.id)}
          onClose={() => setPreviewMovie(null)}
          onDraft={handleDraftFromPreview}
          onToggleFavorite={onToggleFavorite}
          picking={picking}
        />
      )}
    </div>
  )
}
