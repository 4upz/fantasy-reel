'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import type { TMDbSearchResult } from '@/types'
import { useWishlist } from '@/hooks/useWishlist'
import { useDraftMovies, type BrowseFilters } from '../hooks/useDraftMovies'
import DraftFilters from './DraftFilters'
import DraftMovieCard from './DraftMovieCard'
import MovieQuickPreview from './MovieQuickPreview'
import { SpinnerIcon, ClapperboardIcon, TrendingUpIcon, CalendarIcon, HeartIcon, SearchIcon } from './Icons'
import { isWithinDays } from './utils'

interface Props {
  draftedTmdbIds: Set<number>
  isMyTurn: boolean
  picking: boolean
  onPick: (tmdbId: number, movieData: TMDbSearchResult) => void
}

type TabType = 'all' | 'trending' | 'releasing-soon' | 'wishlist'

const TAB_CONFIG: { id: TabType; label: string }[] = [
  { id: 'all', label: 'All Movies' },
  { id: 'trending', label: 'Trending' },
  { id: 'releasing-soon', label: 'Releasing Soon' },
  { id: 'wishlist', label: 'Wishlist' },
]

function getTabIcon(tabId: TabType, className: string = 'w-4 h-4'): React.ReactElement {
  switch (tabId) {
    case 'all':
      return <ClapperboardIcon className={className} />
    case 'trending':
      return <TrendingUpIcon className={className} />
    case 'releasing-soon':
      return <CalendarIcon className={className} />
    case 'wishlist':
      return <HeartIcon className={className} />
  }
}

function EmptyStateIcon({ activeTab, mode }: { activeTab: TabType; mode: string }): React.ReactElement {
  const className = 'w-10 h-10 text-foreground-muted'

  if (activeTab === 'wishlist') return <HeartIcon className={className} />
  if (mode === 'search') return <SearchIcon className={className} />
  return <ClapperboardIcon className={className} />
}

function getEmptyStateMessage(activeTab: TabType, mode: string): string {
  if (activeTab === 'wishlist') return 'Your wishlist is empty. Heart movies to add them here!'
  if (mode === 'search') return 'No movies found for your search'
  return 'No movies match your filters'
}

export default function MoviePicker({
  draftedTmdbIds,
  isMyTurn,
  picking,
  onPick,
}: Props): React.ReactElement {
  const { wishlistedIds } = useWishlist()
  const [activeTab, setActiveTab] = useState<TabType>('all')
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
    fetchTrending,
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

  // Memoize to prevent re-renders (rerender-memo optimization)
  const filteredMovies = useMemo(() => {
    switch (activeTab) {
      case 'trending':
        // Trending data comes from the server via fetchTrending — no client filter needed
        return movies
      case 'releasing-soon':
        return movies.filter((m) => isWithinDays(m.release_date, 30))
      case 'wishlist':
        return movies.filter((m) => wishlistedIds.has(m.tmdb_id))
      default:
        return movies
    }
  }, [movies, activeTab, wishlistedIds])

  // Handle tab changes — fetch trending data server-side or restore browse
  const handleTabChange = useCallback(
    (tab: TabType) => {
      setActiveTab((prev) => {
        if (tab === 'trending') {
          fetchTrending()
        } else if (prev === 'trending') {
          // Leaving trending tab — restore browse results
          browse({ releaseWindow: 'year', genres: [], minRating: 0 })
        }
        return tab
      })
    },
    [fetchTrending, browse]
  )

  // Handle filter changes - hook handles debouncing
  const handleFiltersChange = useCallback(
    (newFilters: BrowseFilters & { search: string }) => {
      const { search: searchValue, ...browseFilters } = newFilters

      // Auto-switch away from trending when user searches or changes filters
      setActiveTab((prev) => (prev === 'trending' ? 'all' : prev))

      if (searchValue) {
        search(searchValue)
      } else {
        browse(browseFilters)
      }
    },
    [browse, search]
  )

  function handleDraftFromPreview(tmdbId: number): void {
    const movie = movies.find((m) => m.tmdb_id === tmdbId)
    if (movie) {
      onPick(tmdbId, movie)
    }
    setPreviewMovie(null)
  }

  // Count available (non-drafted) movies
  const availableCount = filteredMovies.filter((m) => !draftedTmdbIds.has(m.tmdb_id)).length

  return (
    <div className="space-y-6" data-testid="movie-picker">
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
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-gold text-background shadow-md'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface'
            }`}
          >
            {getTabIcon(tab.id)}
            <span>{tab.label}</span>
            {tab.id === 'wishlist' && wishlistedIds.size > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === tab.id ? 'bg-background/20 text-background' : 'bg-crimson text-white'
                }`}
              >
                {wishlistedIds.size}
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
          <div className="flex justify-center mb-3">
            <EmptyStateIcon activeTab={activeTab} mode={mode} />
          </div>
          <p className="text-foreground-secondary">
            {getEmptyStateMessage(activeTab, mode)}
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
                isDrafted={draftedTmdbIds.has(movie.tmdb_id)}
                onPreview={setPreviewMovie}
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

      {/* Movie Detail Modal */}
      {previewMovie && (
        <MovieQuickPreview
          movie={previewMovie}
          isMyTurn={isMyTurn}
          onClose={() => setPreviewMovie(null)}
          onDraft={handleDraftFromPreview}
          picking={picking}
        />
      )}
    </div>
  )
}
