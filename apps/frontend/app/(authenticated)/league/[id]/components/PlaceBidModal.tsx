'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, DollarSign, Search, Film, Sparkles, TrendingUp, Calendar, ArrowLeft } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import type { TMDbSearchResult, TeamBudget, PickupBid } from '@/types'
import { useDraftMovies } from '../hooks/useDraftMovies'
import { getTmdbPosterUrl, formatReleaseDateFull } from './utils'

interface PlaceBidModalProps {
  isOpen: boolean
  onClose: () => void
  budget: TeamBudget | null
  existingBids: PickupBid[]
  draftedTmdbIds: number[]
  onPlaceBid: (tmdbId: number, amount: number, movieData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  counterBidTarget?: PickupBid | null
}

// Quick bid amount buttons for common values
const QUICK_BID_AMOUNTS = [0, 5, 10, 25, 50]

function getValidationErrorMessage(bidAmount: number, remainingBudget: number): string {
  if (bidAmount > remainingBudget) {
    return `Exceeds your budget of $${remainingBudget}`
  }
  if (bidAmount > 100) {
    return 'Maximum bid is $100'
  }
  return 'Bid must be $0 or more'
}

export default function PlaceBidModal({
  isOpen,
  onClose,
  budget,
  existingBids,
  draftedTmdbIds,
  onPlaceBid,
  counterBidTarget,
}: PlaceBidModalProps) {
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [bidAmount, setBidAmount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const modalRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Memoize excluded IDs to prevent infinite re-renders
  const excludedTmdbIds = useMemo(() => {
    const biddedTmdbIds = existingBids.map(b => b.tmdb_id)
    return new Set([...draftedTmdbIds, ...biddedTmdbIds])
  }, [draftedTmdbIds, existingBids])

  const {
    movies: results,
    loading,
    search,
    clearSearch,
  } = useDraftMovies({ draftedTmdbIds: excludedTmdbIds })

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
        // Find the current high bid for this movie and set minimum counter
        const highBid = existingBids
          .filter(b => b.tmdb_id === counterBidTarget.tmdb_id && b.status === 'active')
          .reduce((max, b) => Math.max(max, b.amount), 0)
        setBidAmount(highBid + 1)
      } else {
        setSelectedMovie(null)
        setBidAmount(0)
        // Focus search input after a brief delay for animation
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
      setSearchQuery('')
      clearSearchRef.current()
    }
  }, [isOpen, counterBidTarget, existingBids])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    search(value)
  }

  const handleSubmit = async () => {
    if (!selectedMovie) return

    setIsSubmitting(true)

    const movieData = {
      title: selectedMovie.title,
      overview: selectedMovie.overview,
      poster_url: selectedMovie.poster_url,
      release_date: selectedMovie.release_date,
      vote_average: selectedMovie.vote_average,
      popularity: selectedMovie.popularity,
      genre_ids: selectedMovie.genre_ids,
    }

    const { success, error } = await onPlaceBid(selectedMovie.tmdb_id, bidAmount, movieData)

    setIsSubmitting(false)

    if (success) {
      toast.success(`Bid of $${bidAmount} placed on ${selectedMovie.title}`)
      onClose()
    } else {
      toast.error(error || 'Failed to place bid')
    }
  }

  const remainingBudget = budget?.remaining_budget ?? 0
  const isValidBid = bidAmount >= 0 && bidAmount <= remainingBudget && bidAmount <= 100

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
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
              <h2 className="font-display text-xl font-semibold text-foreground">
                {counterBidTarget ? 'Counter Bid' : selectedMovie ? 'Set Your Bid' : 'Place a Bid'}
              </h2>
              <p className="text-sm text-foreground-muted mt-0.5">
                {selectedMovie
                  ? 'Choose your bid amount'
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

              {/* Results */}
              <div className="space-y-2">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-foreground-muted">Searching movies...</p>
                  </div>
                ) : results.length === 0 ? (
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
                ) : (
                  <>
                    <p className="text-foreground-muted text-sm mb-3">
                      {results.length} movies found
                    </p>
                    {results.map((movie, index) => (
                      <button
                        key={movie.tmdb_id}
                        onClick={() => setSelectedMovie(movie)}
                        className="w-full card card-interactive p-3 flex gap-4 text-left group"
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
                        </div>
                        <div className="flex items-center text-foreground-muted group-hover:text-gold transition-colors">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                      </button>
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
                    {selectedMovie.overview && (
                      <p className="text-foreground-muted text-sm mt-3 line-clamp-2">
                        {selectedMovie.overview}
                      </p>
                    )}
                  </div>
                </div>
              </div>

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
                  />
                </div>

                {!isValidBid ? (
                  <p className="text-error text-sm flex items-center gap-1.5">
                    {getValidationErrorMessage(bidAmount, remainingBudget)}
                  </p>
                ) : (
                  <p className="text-foreground-muted text-sm">
                    {bidAmount === 0
                      ? 'Claim this movie for free if no one else bids'
                      : `You'll spend $${bidAmount} from your budget if you win`}
                  </p>
                )}
              </div>
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
