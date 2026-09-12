'use client'

import { useState, useCallback, useMemo } from 'react'
import type { TMDbSearchResult, WishlistedMovie } from '@/types'
import { useWishlist } from '@/hooks/useWishlist'
import { useFranchiseHistories } from '@/hooks/useFranchiseHistory'
import { useDraftMovies, type DraftMovieRequest } from '../hooks/useDraftMovies'
import DraftFilters, { type DraftFilters as FilterValue } from './DraftFilters'
import DraftMovieCard from './DraftMovieCard'
import MovieQuickPreview from './MovieQuickPreview'
import { SpinnerIcon, ClapperboardIcon, TrendingUpIcon, CalendarIcon, HeartIcon, SearchIcon } from './Icons'

interface Props {
  draftedTmdbIds: Set<number>
  /** The league's season year, which decides which movies are still in play. */
  seasonYear: number
  isMyTurn: boolean
  picking: boolean
  unavailableReason?: string | null
  onPick: (tmdbId: number, movieData: TMDbSearchResult) => Promise<void>
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

function wishlistToTMDbResult(wm: WishlistedMovie): TMDbSearchResult {
  return {
    tmdb_id: wm.tmdb_id,
    title: wm.title,
    poster_url: wm.poster_url,
    overview: null,
    release_date: null,
    vote_average: 0,
    popularity: 0,
    genre_ids: [],
  }
}

export default function MoviePicker({
  draftedTmdbIds,
  seasonYear,
  isMyTurn,
  picking,
  unavailableReason,
  onPick,
}: Props): React.ReactElement {
  const { wishlistedIds, wishlistMovies, isLoading: wishlistLoading, error: wishlistError, retry: retryWishlist } = useWishlist()
  const [discovery, setDiscovery] = useState<{ tab: TabType; filters: FilterValue }>({
    tab: 'all', filters: { releaseWindow: 'year', genres: [], search: '' },
  })
  const { tab: activeTab, filters } = discovery
  const request = useMemo<DraftMovieRequest>(() => {
    if (activeTab === 'trending') return { mode: 'trending' }
    if (filters.search.trim()) return { mode: 'search', query: filters.search.trim() }
    return { mode: 'browse', filters }
  }, [activeTab, filters])
  const [previewMovie, setPreviewMovie] = useState<TMDbSearchResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const {
    movies,
    loading: moviesLoading,
    loadingMore,
    error: moviesError,
    mode,
    hasMore,
    loadMore,
    retry: retryMovies,
  } = useDraftMovies({ draftedTmdbIds, seasonYear, request, enabled: activeTab !== 'wishlist' })

  const loading = activeTab === 'wishlist' ? wishlistLoading : moviesLoading
  const error = activeTab === 'wishlist' ? wishlistError : moviesError
  const retry = activeTab === 'wishlist' ? retryWishlist : retryMovies

  const filteredMovies = useMemo(() => {
    switch (activeTab) {
      case 'wishlist': {
        const loadedMap = new Map(movies.map((m) => [m.tmdb_id, m]))
        const query = filters.search.trim().toLocaleLowerCase()
        return wishlistMovies
          .filter(movie => movie.title.toLocaleLowerCase().includes(query))
          .map(movie => loadedMap.get(movie.tmdb_id) ?? wishlistToTMDbResult(movie))
      }
      default:
        return movies
    }
  }, [movies, activeTab, wishlistMovies, filters.search])

  const franchises = useFranchiseHistories(filteredMovies.map((m) => m.tmdb_id))

  const handleTabChange = useCallback((tab: TabType) => {
    setDiscovery(previous => ({ tab, filters: {
      ...previous.filters, search: '',
      releaseWindow: tab === 'releasing-soon' ? 'next30' : previous.filters.releaseWindow,
    } }))
  }, [])

  const handleFiltersChange = useCallback((filters: FilterValue) => {
    setDiscovery(previous => ({ filters, tab:
      previous.tab === 'wishlist' ? 'wishlist'
        : previous.tab === 'releasing-soon' && filters.releaseWindow === 'next30' && !filters.search.trim()
          ? 'releasing-soon' : 'all',
    }))
  }, [])

  const openPreview = useCallback((movie: TMDbSearchResult) => {
    setPreviewError(null)
    setPreviewMovie(movie)
  }, [])

  const closePreview = useCallback(() => {
    if (picking) return
    setPreviewMovie(null)
    setPreviewError(null)
  }, [picking])

  const handleDraftFromPreview = useCallback(async (tmdbId: number): Promise<void> => {
    if (!previewMovie || previewMovie.tmdb_id !== tmdbId || picking) return
    setPreviewError(null)
    try {
      await onPick(tmdbId, previewMovie)
      setPreviewMovie(null)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not draft this movie. Please try again.')
    }
  }, [previewMovie, picking, onPick])

  const availableCount = filteredMovies.filter((m) => !draftedTmdbIds.has(m.tmdb_id)).length

  const disabledReason = activeTab === 'wishlist'
    ? 'Search filters your wishlist. Release and genre filters are unavailable here.'
    : activeTab === 'trending'
      ? 'Trending shows upcoming titles from TMDb’s weekly list. Release and genre filters are unavailable here.'
      : filters.search.trim()
        ? 'Title search includes upcoming movies across release windows and genres. Clear the search to use these filters.'
        : undefined

  return (
    <div className="space-y-6" data-testid="movie-picker">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="type-panel text-foreground">
          {isMyTurn ? 'Select Your Movie' : 'Browse Movies'}
        </h3>
        {isMyTurn && (
          <span className="badge bg-success-bg text-success border border-success">
            Your turn
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-elevated rounded-xl overflow-x-auto">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            aria-pressed={activeTab === tab.id}
            data-testid={`movie-tab-${tab.id}`}
            className={`type-control flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-gold text-foreground-inverse shadow-md'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface'
            }`}
          >
            {getTabIcon(tab.id)}
            <span>{tab.label}</span>
            {tab.id === 'wishlist' && wishlistedIds.size > 0 && (
              <span
                className={`type-meta px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-foreground/10 text-foreground-inverse' : 'bg-crimson text-white'
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
        value={filters}
        onFiltersChange={handleFiltersChange}
        countLabel={`${availableCount} available ${activeTab === 'wishlist' ? 'in wishlist' : 'loaded'}`}
        loading={loading || loadingMore}
        disabledReason={disabledReason}
      />

      {!disabledReason && <p className="type-body-sm text-foreground-secondary">
        Browse upcoming theatrical releases. Search by title for wider matches.
      </p>}

      {/* Error State */}
      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
          <button type="button" onClick={retry} className="btn btn-secondary mt-3" data-testid="retry-movies-button">
            Retry loading {activeTab === 'wishlist' ? 'wishlist' : 'movies'}
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && movies.length === 0 && (
        <div className="text-center py-12">
          <SpinnerIcon className="w-8 h-8 text-gold mx-auto animate-spin" />
          <p className="text-foreground-secondary mt-3">Loading {activeTab === 'wishlist' ? 'wishlist' : 'movies'}...</p>
        </div>
      )}

      {/* Movie Grid */}
      {!loading && !loadingMore && !error && filteredMovies.length === 0 ? (
        <div className="text-center py-12 bg-elevated rounded-xl border border-border">
          <div className="flex justify-center mb-3">
            <EmptyStateIcon activeTab={activeTab} mode={mode} />
          </div>
          <p className="text-foreground-secondary">
            {hasMore ? 'No available movies in the pages loaded so far. More pages may have matches.'
              : activeTab === 'wishlist' && filters.search.trim()
                ? 'No wishlist movies match your search'
                : getEmptyStateMessage(activeTab, mode)}
          </p>
          {activeTab !== 'all' && (
            <button
              onClick={() => handleTabChange('all')}
              className="type-control mt-3 text-gold hover:text-gold-hover transition-colors"
            >
              View all movies
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredMovies.map((movie) => (
              <DraftMovieCard
                key={movie.tmdb_id}
                movie={movie}
                isDrafted={draftedTmdbIds.has(movie.tmdb_id)}
                franchise={franchises.get(movie.tmdb_id) ?? null}
                onPreview={openPreview}
              />
            ))}
        </div>
      )}

      {activeTab !== 'wishlist' && (hasMore || loadingMore) && (
        <div className="flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading || loadingMore || Boolean(error)}
            className="btn btn-secondary" data-testid="load-more-movies-button">
            {loadingMore ? <><SpinnerIcon className="w-4 h-4 mr-2 animate-spin" /> Loading more movies...</> : 'Load more movies'}
          </button>
        </div>
      )}

      {/* Movie Detail Modal */}
      {previewMovie && (
        <MovieQuickPreview
          movie={previewMovie}
          seasonYear={seasonYear}
          isMyTurn={isMyTurn}
          isDrafted={draftedTmdbIds.has(previewMovie.tmdb_id)}
          unavailableReason={unavailableReason}
          error={previewError}
          onClose={closePreview}
          onDraft={handleDraftFromPreview}
          picking={picking}
        />
      )}
    </div>
  )
}
