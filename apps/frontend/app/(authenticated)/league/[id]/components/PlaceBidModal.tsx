'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, DollarSign, Search, Film } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import type { TMDbSearchResult, TeamBudget, PickupBid } from '@/types'
import { useDraftMovies } from '../hooks/useDraftMovies'
import { getTmdbPosterUrl } from './utils'

interface PlaceBidModalProps {
  isOpen: boolean
  onClose: () => void
  budget: TeamBudget | null
  existingBids: PickupBid[]
  draftedTmdbIds: number[]
  onPlaceBid: (tmdbId: number, amount: number, movieData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  counterBidTarget?: PickupBid | null
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

  // Memoize excluded IDs to prevent infinite re-renders
  // The Set must be stable to avoid recreating useDraftMovies callbacks
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
      <div ref={modalRef} className="glass max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-xl font-semibold text-foreground">
            {counterBidTarget ? 'Counter Bid' : 'Place a Bid'}
          </h2>
          <button onClick={onClose} className="btn btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Budget Display */}
        <div className="px-4 py-3 bg-elevated/50 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-foreground-secondary">Available Budget</span>
            <span className="font-display font-semibold text-gold text-lg">
              ${remainingBudget}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedMovie ? (
            <>
              {/* Search Input */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search for a movie..."
                  className="input w-full pl-10"
                  autoFocus
                />
              </div>

              {/* Results */}
              <div className="space-y-2">
                {loading ? (
                  <div className="text-center py-8 text-foreground-muted">
                    Searching...
                  </div>
                ) : results.length === 0 ? (
                  <div className="text-center py-8 text-foreground-muted">
                    {searchQuery ? 'No movies found' : 'Search for a movie to place a bid'}
                  </div>
                ) : (
                  results.map((movie) => (
                    <button
                      key={movie.tmdb_id}
                      onClick={() => setSelectedMovie(movie)}
                      className="w-full card card-interactive p-3 flex gap-3 text-left"
                    >
                      <div className="relative w-12 h-18 flex-shrink-0 rounded overflow-hidden bg-elevated">
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
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground truncate">{movie.title}</h4>
                        <p className="text-sm text-foreground-secondary">
                          {movie.release_date ? new Date(movie.release_date).getFullYear() : 'TBA'}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* Selected Movie */}
              <div className="card p-4 mb-4">
                <div className="flex gap-4">
                  <div className="relative w-20 h-30 flex-shrink-0 rounded overflow-hidden bg-elevated">
                    {selectedMovie.poster_url ? (
                      <Image
                        src={getTmdbPosterUrl(selectedMovie.poster_url, 'w154')!}
                        alt={selectedMovie.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-8 h-8 text-foreground-muted" />
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-lg text-foreground">
                      {selectedMovie.title}
                    </h3>
                    <p className="text-foreground-secondary">
                      {selectedMovie.release_date
                        ? new Date(selectedMovie.release_date).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Release date TBA'}
                    </p>
                    {!counterBidTarget && (
                      <button
                        onClick={() => setSelectedMovie(null)}
                        className="text-gold text-sm mt-2 hover:underline"
                      >
                        Choose different movie
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Bid Amount Input */}
              <div className="space-y-2">
                <label className="block text-foreground-secondary text-sm">
                  Bid Amount
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                    min={0}
                    max={Math.min(100, remainingBudget)}
                    className={`input w-full pl-10 text-lg ${!isValidBid ? 'border-error' : ''}`}
                    autoFocus
                  />
                </div>
                {!isValidBid && (
                  <p className="text-error text-sm">
                    {bidAmount > remainingBudget
                      ? `Exceeds your budget of $${remainingBudget}`
                      : bidAmount > 100
                      ? 'Maximum bid is $100'
                      : 'Bid must be $0 or more'}
                  </p>
                )}
                <p className="text-foreground-muted text-sm">
                  You can bid $0 to claim unclaimed movies for free.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {selectedMovie && (
          <div className="p-4 border-t border-border bg-elevated/30">
            <button
              onClick={handleSubmit}
              disabled={!isValidBid || isSubmitting}
              className="btn btn-primary w-full"
            >
              {isSubmitting ? 'Placing Bid...' : `Place $${bidAmount} Bid`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
