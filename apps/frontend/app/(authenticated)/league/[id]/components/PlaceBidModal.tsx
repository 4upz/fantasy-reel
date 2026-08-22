'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { X, DollarSign, Search, Film, Sparkles, TrendingUp, Calendar, ArrowLeft, Heart, Swords } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import type { TMDbSearchResult, TeamBudget, PickupBid, DroppableHolding } from '@/types'
import { useDraftMovies } from '../hooks/useDraftMovies'
import { getTmdbPosterUrl, formatReleaseDateFull, isMovieBiddable, formatDeadlineShort } from './utils'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { WishlistToggle } from '@/components/WishlistToggle'
import { useWishlist } from '@/hooks/useWishlist'

interface PlaceBidModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  budget: TeamBudget | null
  existingBids: PickupBid[]
  ownedTmdbIds: number[]
  onPlaceBid: (
    tmdbId: number,
    amount: number,
    movieData: Record<string, unknown>,
    conditionalDrop?: { source: 'draft' | 'pickup'; holdingId: string } | null,
  ) => Promise<{ success: boolean; error?: string }>
  /** The team's active holdings, offered as conditional drop targets. */
  myHoldings: DroppableHolding[]
  /** Roster slots still open. Zero means this bid needs a drop to be honored. */
  freeRosterSlots: number
  counterBidTarget?: PickupBid | null
  /**
   * Past the new-bid cutoff the modal stops being a movie search and becomes a
   * picker over the contest already running: searching a catalogue you are not
   * allowed to bid from is a dead end, and the movies in play are the actual
   * choice available.
   */
  isCounterBidPhase?: boolean
  newBidCutoffAt?: string | null
}

// Quick bid amount buttons for common values
const QUICK_BID_AMOUNTS = [0, 5, 10, 25, 50]

/** The current high active bid on a movie, and whether it belongs to this team. */
interface ActiveBidInfo {
  high: number
  mine: boolean
}

interface ActiveBidChipProps {
  tmdbId: number
  info: ActiveBidInfo | undefined
}

/** Badge on a search result showing the leading bid already placed on a movie. */
function ActiveBidChip({ tmdbId, info }: ActiveBidChipProps): React.ReactElement | null {
  if (!info) return null

  return (
    <span
      className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
        info.mine
          ? 'bg-gold-muted text-gold border-gold/30'
          : 'bg-warning-bg/30 text-warning border-warning/20'
      }`}
      data-testid={`bid-chip-${tmdbId}`}
    >
      <DollarSign className="w-3 h-3" />
      {info.mine ? `Your bid $${info.high}` : `High bid $${info.high}`}
    </span>
  )
}

function getModalTitle(
  counterBidTarget: PickupBid | null | undefined,
  teamId: string,
  hasSelectedMovie: boolean,
  isCounterBidPhase: boolean,
): string {
  if (counterBidTarget) {
    return counterBidTarget.team_id === teamId ? 'Raise Your Bid' : 'Counter Bid'
  }
  if (hasSelectedMovie) return 'Set Your Bid'
  return isCounterBidPhase ? 'Counter a Bid' : 'Place a Bid'
}

type BidResultsState = 'loading' | 'no-contests' | 'no-results' | 'no-wishlist-matches' | 'list'

/**
 * Which of the results panel's states to show.
 *
 * Past the cutoff the panel is a fixed list of the contests already running:
 * nothing is fetched and the wishlist filter isn't offered, so the only two
 * outcomes are the list itself or "nobody bid this week".
 */
function getBidResultsState(params: {
  isCounterBidPhase: boolean
  loading: boolean
  searchResultCount: number
  displayedCount: number
}): BidResultsState {
  const { isCounterBidPhase, loading, searchResultCount, displayedCount } = params

  if (isCounterBidPhase) {
    return displayedCount === 0 ? 'no-contests' : 'list'
  }
  if (loading) return 'loading'
  if (searchResultCount === 0) return 'no-results'
  if (displayedCount === 0) return 'no-wishlist-matches'
  return 'list'
}

function getValidationErrorMessage(bidAmount: number, remainingBudget: number, highestBid: number | null): string {
  if (bidAmount > remainingBudget) {
    return `Exceeds your budget of $${remainingBudget}`
  }
  if (bidAmount > 100) {
    return 'Maximum bid is $100'
  }
  if (highestBid !== null && bidAmount <= highestBid) {
    return `Must be higher than current bid of $${highestBid}`
  }
  return 'Bid must be $0 or more'
}

export default function PlaceBidModal({
  isOpen,
  onClose,
  teamId,
  budget,
  existingBids,
  ownedTmdbIds,
  onPlaceBid,
  myHoldings,
  freeRosterSlots,
  counterBidTarget,
  isCounterBidPhase = false,
  newBidCutoffAt = null,
}: PlaceBidModalProps) {
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [bidAmount, setBidAmount] = useState(0)
  /** holding_id of the movie to release if this bid wins, or '' for none. */
  const [dropHoldingId, setDropHoldingId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showWishlistedOnly, setShowWishlistedOnly] = useState(false)

  const { isWishlisted } = useWishlist()

  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Only movies already on someone's roster (drafted or picked up) are
  // unavailable. Movies with pending bids stay searchable so teams can compete
  // for them. Memoized to prevent infinite re-renders.
  const excludedTmdbIds = useMemo(() => new Set(ownedTmdbIds), [ownedTmdbIds])

  // Current high active bid per movie, so search results can flag movies that
  // already have a bid and the amount step can enforce outbidding it.
  const activeBidsByTmdbId = useMemo(() => {
    const map = new Map<number, ActiveBidInfo>()
    for (const bid of existingBids) {
      if (bid.status !== 'active') continue
      const current = map.get(bid.tmdb_id)
      if (!current || bid.amount > current.high) {
        map.set(bid.tmdb_id, { high: bid.amount, mine: bid.team_id === teamId })
      }
    }
    return map
  }, [existingBids, teamId])

  const {
    movies: results,
    loading,
    search,
    clearSearch,
  } = useDraftMovies({ draftedTmdbIds: excludedTmdbIds, enabled: !isCounterBidPhase })

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Store clearSearch in a ref to avoid dependency issues
  const clearSearchRef = useRef(clearSearch)
  clearSearchRef.current = clearSearch

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (counterBidTarget?.movie_data) {
        // Pre-select the movie for counter-bidding
        const movieData = counterBidTarget.movie_data as {
          title: string
          overview?: string | null
          poster_url?: string | null
          release_date?: string | null
          vote_average?: number
          popularity?: number
          genre_ids?: number[]
        }
        setSelectedMovie({
          tmdb_id: counterBidTarget.tmdb_id,
          title: movieData.title,
          overview: movieData.overview || null,
          poster_url: movieData.poster_url || null,
          release_date: movieData.release_date || null,
          vote_average: movieData.vote_average ?? 0,
          popularity: movieData.popularity ?? 0,
          genre_ids: movieData.genre_ids || [],
        })
        // Open at the smallest amount that takes the lead.
        const highBid = activeBidsByTmdbId.get(counterBidTarget.tmdb_id)?.high ?? 0
        setBidAmount(highBid + 1)
      } else {
        setSelectedMovie(null)
        setBidAmount(0)
        // Focus search input after a brief delay for animation
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
      // A drop chosen for a previous bid must never carry over to the next one.
      setDropHoldingId('')
      setSearchQuery('')
      clearSearchRef.current()
    }
  }, [isOpen, counterBidTarget, activeBidsByTmdbId])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    search(value)
  }

  // Selecting a movie that already has an active bid starts the amount at the
  // minimum needed to take the lead.
  const selectMovie = useCallback((movie: TMDbSearchResult) => {
    setSelectedMovie(movie)
    const bidInfo = activeBidsByTmdbId.get(movie.tmdb_id)
    setBidAmount(bidInfo ? bidInfo.high + 1 : 0)
  }, [activeBidsByTmdbId])

  const selectedBidInfo = selectedMovie ? activeBidsByTmdbId.get(selectedMovie.tmdb_id) : undefined
  const highestBid = selectedBidInfo?.high ?? null

  const submitBidAction = useCallback(async () => {
    if (!selectedMovie) return

    // Guard against a stale movie list: the search results were fetched when the
    // modal opened, so a movie can release while it's still sitting on screen.
    if (!isMovieBiddable(selectedMovie.release_date)) {
      toast.error(`${selectedMovie.title} has already released and can no longer be bid on`)
      return
    }

    const movieData = {
      title: selectedMovie.title,
      overview: selectedMovie.overview,
      poster_url: selectedMovie.poster_url,
      release_date: selectedMovie.release_date,
      vote_average: selectedMovie.vote_average,
      popularity: selectedMovie.popularity,
      genre_ids: selectedMovie.genre_ids,
    }

    const drop = myHoldings.find((holding) => holding.holding_id === dropHoldingId)

    const { success, error } = await onPlaceBid(
      selectedMovie.tmdb_id,
      bidAmount,
      movieData,
      drop ? { source: drop.source, holdingId: drop.holding_id } : null,
    )

    if (!success) {
      toast.error(error || 'Failed to place bid')
      return
    }

    toast.success(
      drop
        ? `Bid of $${bidAmount} placed on ${selectedMovie.title}. ${drop.title} drops if it wins.`
        : `Bid of $${bidAmount} placed on ${selectedMovie.title}`
    )
    onClose()
  }, [selectedMovie, bidAmount, dropHoldingId, myHoldings, onPlaceBid, onClose])

  const { execute: handleSubmit, isLoading: isSubmitting } = useAsyncAction(submitBidAction)

  const remainingBudget = budget?.remaining_budget ?? 0
  const isValidBid = bidAmount >= 0 && bidAmount <= remainingBudget && bidAmount <= 100 &&
    (highestBid === null || bidAmount > highestBid)

  // The movies still in play, rebuilt from the bids themselves. 'outbid' rows
  // count: that contest is live and its team can counter back. movie_data was
  // captured from TMDb when the bid was placed, so it already carries
  // everything a search result would.
  const contestedMovies = useMemo(() => {
    const byTmdbId = new Map<number, TMDbSearchResult>()
    for (const bid of existingBids) {
      if (bid.status !== 'active' && bid.status !== 'outbid') continue
      if (excludedTmdbIds.has(bid.tmdb_id) || byTmdbId.has(bid.tmdb_id)) continue

      const data = bid.movie_data as Partial<TMDbSearchResult> | null

      // A released movie can no longer be bid on, so listing one here would be
      // a dead end -- the server rejects it once the amount is filled in. The
      // bid cards gate their "Counter Bid" button the same way.
      if (!isMovieBiddable(data?.release_date ?? null)) continue

      byTmdbId.set(bid.tmdb_id, {
        tmdb_id: bid.tmdb_id,
        title: data?.title ?? `Movie #${bid.tmdb_id}`,
        overview: data?.overview ?? null,
        release_date: data?.release_date ?? null,
        poster_url: data?.poster_url ?? null,
        vote_average: data?.vote_average ?? 0,
        popularity: data?.popularity ?? 0,
        genre_ids: data?.genre_ids ?? [],
      })
    }
    // Highest bid first: the contests that need answering are the loud ones.
    return [...byTmdbId.values()].sort(
      (a, b) => (activeBidsByTmdbId.get(b.tmdb_id)?.high ?? 0) - (activeBidsByTmdbId.get(a.tmdb_id)?.high ?? 0)
    )
  }, [existingBids, excludedTmdbIds, activeBidsByTmdbId])

  const searchResults = showWishlistedOnly
    ? results.filter(m => isWishlisted(m.tmdb_id))
    : results

  const displayedResults = isCounterBidPhase ? contestedMovies : searchResults

  const resultsState = getBidResultsState({
    isCounterBidPhase,
    loading,
    searchResultCount: results.length,
    displayedCount: displayedResults.length,
  })

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-bid-title"
        className="glass modal-panel max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-border shadow-heavy"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            {selectedMovie && !counterBidTarget && (
              <button
                onClick={() => setSelectedMovie(null)}
                className="btn btn-ghost p-2 -ml-2"
                aria-label="Back to search"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 id="place-bid-title" className="font-display text-xl font-semibold text-foreground">
                {getModalTitle(counterBidTarget, teamId, !!selectedMovie, isCounterBidPhase)}
              </h2>
              <p className="text-sm text-foreground-muted mt-0.5">
                {selectedMovie
                  ? 'Choose your bid amount'
                  : isCounterBidPhase
                    ? 'Pick a movie already being bid on'
                    : 'Search for a movie to bid on'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost p-2 hover:bg-surface-hover rounded-full"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Budget Display - Always visible */}
        <div className="px-5 py-3 bg-elevated/30 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-foreground-secondary text-sm">Available Budget</span>
            <span className="bid-amount-display text-xl">
              ${remainingBudget}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!selectedMovie ? (
            <div className="p-5">
              {isCounterBidPhase ? (
                /* No search: after the cutoff the only legal targets are the
                   movies already in play, so those are what the modal offers. */
                <div
                  className="flex gap-3 p-3.5 mb-5 rounded-lg border border-gold/25 bg-gold-muted"
                  data-testid="counter-bid-phase-notice"
                >
                  <Swords className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      New bids closed{newBidCutoffAt ? ` ${formatDeadlineShort(newBidCutoffAt)}` : ''}
                    </p>
                    <p className="text-xs text-foreground-secondary mt-1 leading-relaxed">
                      Raise your bid or counter another team&apos;s on the movies below. Movies
                      nobody has bid on reopen once this week&apos;s bids are processed.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Search Input */}
                  <div className="relative mb-5">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder="Search for a movie..."
                      className="input w-full pl-12 py-3 text-base"
                      data-testid="bid-movie-search-input"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => handleSearchChange('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 btn btn-ghost p-1.5 rounded-full"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Filter Toggle */}
                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => setShowWishlistedOnly(prev => !prev)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all ${
                        showWishlistedOnly
                          ? 'bg-crimson/20 text-crimson border border-crimson/30'
                          : 'bg-elevated text-foreground-muted border border-border hover:border-border-hover'
                      }`}
                      aria-pressed={showWishlistedOnly}
                    >
                      <Heart className="w-3.5 h-3.5" fill={showWishlistedOnly ? 'currentColor' : 'none'} />
                      Wishlisted
                    </button>
                  </div>
                </>
              )}

              {/* Results */}
              <div className="space-y-2">
                {resultsState === 'loading' && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-foreground-muted">Searching movies...</p>
                  </div>
                )}

                {resultsState === 'no-contests' && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Swords className="w-12 h-12 text-foreground-muted mb-4" />
                    <p className="text-foreground-secondary font-medium">No bids in play</p>
                    <p className="text-foreground-muted text-sm mt-1 max-w-xs">
                      Nobody placed a bid before the deadline. Bidding reopens once this
                      week&apos;s bids are processed.
                    </p>
                  </div>
                )}

                {resultsState === 'no-results' && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Film className="w-12 h-12 text-foreground-muted mb-4" />
                    <p className="text-foreground-secondary font-medium">
                      {searchQuery ? 'No movies found' : 'Search for a movie'}
                    </p>
                    <p className="text-foreground-muted text-sm mt-1">
                      {searchQuery
                        ? 'Try a different search term'
                        : 'Type a movie title above to get started'}
                    </p>
                  </div>
                )}

                {resultsState === 'no-wishlist-matches' && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Heart className="w-12 h-12 text-foreground-muted mb-4" />
                    <p className="text-foreground-secondary font-medium">No wishlisted movies found</p>
                    <p className="text-foreground-muted text-sm mt-1">
                      Add movies to your wishlist first, then filter here
                    </p>
                  </div>
                )}

                {resultsState === 'list' && (
                  <>
                    <p className="text-foreground-muted text-sm mb-3">
                      {isCounterBidPhase
                        ? `${displayedResults.length} ${displayedResults.length === 1 ? 'movie' : 'movies'} still being bid on`
                        : `${displayedResults.length} movies found`}
                    </p>
                    {displayedResults.map((movie, index) => (
                      <div
                        key={movie.tmdb_id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectMovie(movie)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectMovie(movie)
                          }
                        }}
                        data-testid={`bid-movie-result-${movie.tmdb_id}`}
                        className="w-full card card-interactive p-3 flex gap-4 text-left group cursor-pointer"
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        <div className="relative w-14 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
                          {movie.poster_url ? (
                            <Image
                              src={getTmdbPosterUrl(movie.poster_url, 'w92')!}
                              alt={movie.title}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Film className="w-6 h-6 text-foreground-muted" />
                            </div>
                          )}
                          <WishlistToggle movie={movie} size="sm" variant="overlay" className="absolute top-0.5 right-0.5" />
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <h4 className="font-display font-semibold text-foreground truncate group-hover:text-gold transition-colors">
                            {movie.title}
                          </h4>
                          <div className="flex items-center gap-3 mt-1.5 text-sm text-foreground-secondary">
                            {movie.release_date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {new Date(movie.release_date).getFullYear()}
                              </span>
                            )}
                            {movie.vote_average > 0 && (
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-gold" />
                                {movie.vote_average.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <ActiveBidChip
                            tmdbId={movie.tmdb_id}
                            info={activeBidsByTmdbId.get(movie.tmdb_id)}
                          />
                        </div>
                        <div className="flex items-center text-foreground-muted group-hover:text-gold transition-colors">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5">
              {/* Selected Movie Card */}
              <div className="card p-4 mb-6 bg-surface/50">
                <div className="flex gap-4">
                  <div className="relative w-24 h-36 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-medium">
                    {selectedMovie.poster_url ? (
                      <Image
                        src={getTmdbPosterUrl(selectedMovie.poster_url, 'w154')!}
                        alt={selectedMovie.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-10 h-10 text-foreground-muted" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-xl text-foreground">
                      {selectedMovie.title}
                    </h3>
                    <p className="text-foreground-secondary mt-1 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      {formatReleaseDateFull(selectedMovie.release_date) || 'Release date TBA'}
                    </p>
                    {selectedMovie.vote_average > 0 && (
                      <p className="text-foreground-secondary mt-1 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-gold" />
                        {selectedMovie.vote_average.toFixed(1)} rating
                      </p>
                    )}
                    {highestBid !== null && (
                      <div className="mt-3 px-3 py-1.5 bg-warning-bg/30 border border-warning/20 rounded-lg inline-flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-warning" />
                        <span className="text-warning text-sm font-medium">
                          {selectedBidInfo?.mine
                            ? `Your current bid: $${highestBid}`
                            : `Current high bid: $${highestBid}`}
                        </span>
                      </div>
                    )}
                    {selectedMovie.overview && (
                      <p className="text-foreground-muted text-sm mt-3 line-clamp-2">
                        {selectedMovie.overview}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Sits above the amount step on purpose: whether this bid can
                  land at all matters more than what it costs, and below the
                  amount input it fell under the sticky footer at common
                  viewport heights -- a warning you have to scroll for is not
                  doing its job. */}
              {freeRosterSlots === 0 && !dropHoldingId && (
                <div className="alert alert-warning mb-6" data-testid="full-roster-warning">
                  {myHoldings.length > 0
                    ? 'Your roster is full. You can still place this bid, but it can only be honored if you choose a movie to drop below, or a slot frees up before bids are processed.'
                    : 'Your roster is full and none of your movies can be dropped — they have all released or been counterpicked. You can still place this bid, but it can only be honored if a slot frees up before bids are processed.'}
                </div>
              )}

              {/* Bid Amount Section */}
              <div className="space-y-4">
                <label className="block text-foreground font-semibold">
                  Your Bid Amount
                </label>

                {/* Quick Amount Buttons */}
                <div className="flex flex-wrap gap-2">
                  {QUICK_BID_AMOUNTS.filter(amt => amt <= remainingBudget).map(amount => (
                    <button
                      key={amount}
                      onClick={() => setBidAmount(amount)}
                      className={`btn text-sm px-4 py-2 ${
                        bidAmount === amount
                          ? 'btn-primary'
                          : 'btn-secondary'
                      }`}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>

                {/* Custom Amount Input */}
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gold" />
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                    min={0}
                    max={Math.min(100, remainingBudget)}
                    className={`input w-full pl-14 py-4 text-2xl font-display font-bold text-center ${
                      !isValidBid ? 'border-error focus:border-error' : 'focus:border-gold'
                    }`}
                    data-testid="bid-amount-input"
                  />
                </div>

                {!isValidBid ? (
                  <p className="text-error text-sm flex items-center gap-1.5">
                    {getValidationErrorMessage(bidAmount, remainingBudget, highestBid)}
                  </p>
                ) : (
                  <p className="text-foreground-muted text-sm">
                    {bidAmount === 0
                      ? 'Claim this movie for free if no one else bids'
                      : `You'll spend $${bidAmount} from your budget if you win`}
                  </p>
                )}
              </div>

              {/* Conditional drop: a movie released only if this bid wins, which
                  is what lets a full roster keep bidding. Only holdings that
                  could actually be dropped reach this list -- a released or
                  counterpicked movie would fail at processing, too late to
                  choose again. */}
              {myHoldings.length > 0 && (
                <div className="mt-6 space-y-2">
                  <label
                    htmlFor="conditional-drop"
                    className="block text-sm font-medium text-foreground"
                  >
                    If this bid wins, also drop
                  </label>
                  <select
                    id="conditional-drop"
                    className="input w-full"
                    value={dropHoldingId}
                    onChange={(e) => setDropHoldingId(e.target.value)}
                    data-testid="conditional-drop-select"
                  >
                    <option value="">Nothing — keep my whole roster</option>
                    {myHoldings.map((holding) => (
                      <option key={holding.holding_id} value={holding.holding_id}>
                        {holding.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer - Submit Button */}
        {selectedMovie && (
          <div className="p-5 border-t border-border bg-elevated/30">
            <button
              onClick={handleSubmit}
              disabled={!isValidBid || isSubmitting}
              className="btn btn-primary w-full py-3 text-base font-semibold"
              data-testid="submit-bid-button"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-foreground-inverse border-t-transparent rounded-full animate-spin" />
                  Placing Bid...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Place ${bidAmount} Bid
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
