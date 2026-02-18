'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { X, DollarSign, Target, ArrowLeft, Film } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import type { TeamBudget, CounterpickBid, CounterpickOption } from '@/types'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { getTmdbPosterUrl, formatReleaseDateFull } from './utils'
import CounterpickPicker from './CounterpickPicker'

interface PlaceCounterpickBidModalProps {
  isOpen: boolean
  onClose: () => void
  leagueId: string
  teamId: string
  budget: TeamBudget | null
  counterpickBids: CounterpickBid[]
  onPlaceCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  counterTarget?: CounterpickBid | null
}

// Quick bid amount buttons for common values
const QUICK_BID_AMOUNTS = [0, 5, 10, 25, 50]

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

interface SelectedMovieInfo {
  movieId: string
  title: string
  posterUrl: string | null
  releaseDate: string | null
  targetTeamName: string
}

export default function PlaceCounterpickBidModal({
  isOpen,
  onClose,
  leagueId,
  teamId,
  budget,
  counterpickBids,
  onPlaceCounterpickBid,
  counterTarget,
}: PlaceCounterpickBidModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedMovie, setSelectedMovie] = useState<SelectedMovieInfo | null>(null)
  const [bidAmount, setBidAmount] = useState(0)

  const modalRef = useRef<HTMLDivElement>(null)

  // Find highest active bid for the selected movie
  const highestBid = useMemo(() => {
    if (!selectedMovie) return null
    const activeBids = counterpickBids.filter(
      b => b.movie_id === selectedMovie.movieId && b.status === 'active'
    )
    if (activeBids.length === 0) return null
    return Math.max(...activeBids.map(b => b.amount))
  }, [counterpickBids, selectedMovie])

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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (counterTarget) {
        // Counter-bid mode: skip step 1, pre-select the movie
        const movieInfo: SelectedMovieInfo = {
          movieId: counterTarget.movie_id,
          title: counterTarget.movies?.title || 'Unknown Movie',
          posterUrl: counterTarget.movies?.poster_url || null,
          releaseDate: counterTarget.movies?.release_date || null,
          targetTeamName: counterTarget.target_team?.name || 'Unknown Team',
        }
        setSelectedMovie(movieInfo)
        // Set minimum counter amount
        const currentHigh = counterpickBids
          .filter(b => b.movie_id === counterTarget.movie_id && b.status === 'active')
          .reduce((max, b) => Math.max(max, b.amount), 0)
        setBidAmount(currentHigh + 1)
        setStep(2)
      } else {
        setSelectedMovie(null)
        setBidAmount(0)
        setStep(1)
      }
    }
  }, [isOpen, counterTarget, counterpickBids])

  const handlePickerSelect = useCallback(async (_movieId: string, option: CounterpickOption) => {
    setSelectedMovie({
      movieId: option.movie_id,
      title: option.movie_title,
      posterUrl: option.poster_url,
      releaseDate: option.release_date,
      targetTeamName: option.owner_team_name,
    })
    setBidAmount(0)
    setStep(2)
  }, [])

  const submitBidAction = useCallback(async () => {
    if (!selectedMovie) return

    const { success, error } = await onPlaceCounterpickBid(selectedMovie.movieId, bidAmount)

    if (!success) {
      toast.error(error || 'Failed to place counterpick bid')
      return
    }

    toast.success(`Counterpick bid of $${bidAmount} placed on ${selectedMovie.title}`)
    onClose()
  }, [selectedMovie, bidAmount, onPlaceCounterpickBid, onClose])

  const { execute: handleSubmit, isLoading: isSubmitting } = useAsyncAction(submitBidAction)

  const remainingBudget = budget?.remaining_budget ?? 0
  const isValidBid = useMemo(() => {
    if (bidAmount < 0 || bidAmount > remainingBudget || bidAmount > 100) return false
    if (highestBid !== null && bidAmount <= highestBid) return false
    return true
  }, [bidAmount, remainingBudget, highestBid])

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-counterpick-bid-title"
        className="glass modal-panel max-w-2xl w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-border shadow-heavy"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            {step === 2 && !counterTarget && (
              <button
                onClick={() => {
                  setStep(1)
                  setSelectedMovie(null)
                }}
                className="btn btn-ghost p-2 -ml-2"
                aria-label="Back to movie selection"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 id="place-counterpick-bid-title" className="font-display text-xl font-semibold text-foreground">
                {counterTarget ? 'Counter Counterpick Bid' : step === 2 ? 'Set Your Bid' : 'Place Counterpick Bid'}
              </h2>
              <p className="text-sm text-foreground-muted mt-0.5">
                {step === 2
                  ? 'Choose your bid amount'
                  : 'Select an opponent movie to counterpick'}
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
          {step === 1 ? (
            <div className="p-5">
              <CounterpickPicker
                leagueId={leagueId}
                teamId={teamId}
                isMyTurn={true}
                isPicking={false}
                onPick={handlePickerSelect}
              />
            </div>
          ) : selectedMovie ? (
            <div className="p-5">
              {/* Selected Movie Card */}
              <div className="card p-4 mb-6 bg-surface/50">
                <div className="flex gap-4">
                  <div className="relative w-24 h-36 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-medium">
                    {selectedMovie.posterUrl ? (
                      <Image
                        src={getTmdbPosterUrl(selectedMovie.posterUrl, 'w154')!}
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
                      <Target className="w-4 h-4 text-crimson" />
                      vs {selectedMovie.targetTeamName}
                    </p>
                    {selectedMovie.releaseDate && (
                      <p className="text-foreground-muted text-sm mt-1">
                        {formatReleaseDateFull(selectedMovie.releaseDate)}
                      </p>
                    )}
                    {highestBid !== null && (
                      <div className="mt-3 px-3 py-1.5 bg-warning-bg/30 border border-warning/20 rounded-lg inline-flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-warning" />
                        <span className="text-warning text-sm font-medium">
                          Current high bid: ${highestBid}
                        </span>
                      </div>
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
                    data-testid="counterpick-bid-amount-input"
                  />
                </div>

                {!isValidBid ? (
                  <p className="text-error text-sm flex items-center gap-1.5">
                    {getValidationErrorMessage(bidAmount, remainingBudget, highestBid)}
                  </p>
                ) : (
                  <p className="text-foreground-muted text-sm">
                    {bidAmount === 0
                      ? 'Claim this counterpick for free if no one else bids'
                      : `You'll spend $${bidAmount} from your budget if you win`}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer - Submit Button */}
        {step === 2 && selectedMovie && (
          <div className="p-5 border-t border-border bg-elevated/30">
            <button
              onClick={handleSubmit}
              disabled={!isValidBid || isSubmitting}
              className="btn btn-primary w-full py-3 text-base font-semibold"
              data-testid="submit-counterpick-bid-button"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-foreground-inverse border-t-transparent rounded-full animate-spin" />
                  Placing Bid...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Target className="w-5 h-5" />
                  Place ${bidAmount} Counterpick Bid
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
