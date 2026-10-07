'use client'

import MoviePoster from '@/app/components/MoviePoster'
import { AlertTriangle, Lock, Target, Trash2 } from 'lucide-react'
import type { CounterpickBid } from '@/types'
import BidAmountAndDeadline from './BidAmountAndDeadline'
import { getBidTypeClass } from './utils'
import ScoreLockLabel from '@/app/components/ScoreLockLabel'

interface CounterpickBidCardProps {
  bid: CounterpickBid
  isOwner: boolean
  onCancel?: () => void
  /** See BidCard: the bid is committed for the week once the cutoff passes. */
  cancelLocked?: boolean
  onCounter?: () => void
  bidType?: 'pickup' | 'counterpick'
  /**
   * When another bid on the same movie still has an open counter-response
   * window, processing of the whole group is held until it closes. Set to that
   * window's end so the card explains the delay instead of "Processing soon".
   */
  counterWindowClosesAt?: string | null
  /** See BidCard: the movie got its score, so processing will cancel the bid. */
  scoreLocked?: boolean
}

/** @design-system League */
export default function CounterpickBidCard({ bid, isOwner, onCancel, cancelLocked, onCounter, bidType, counterWindowClosesAt, scoreLocked }: CounterpickBidCardProps) {
  const isOutbid = bid.status === 'outbid'
  const isActive = bid.status === 'active'
  const isPending = isActive || isOutbid
  const movieTitle = bid.movies?.title || 'Unknown Movie'
  const posterUrl = bid.movies?.poster_url || null

  const typeClass = getBidTypeClass(bidType)

  // An outbid bid gets a prominent "Counter bid" prompt; an active one gets a
  // quieter option to raise your own bid or outbid a rival's.
  const showRecoverButton = isOutbid && isOwner && !!onCounter
  const showRaiseButton = isActive && !!onCounter
  const showCancelButton = isOwner && isPending && !!onCancel
  const showCancelLock = isOwner && isPending && !onCancel && !!cancelLocked

  return (
    <div
      className={`card bid-card-interactive p-4 ${typeClass} ${
        isOutbid ? 'border-warning bg-warning-bg/20 outbid-pulse motion-reduce:animate-none' : ''
      }`}
      data-testid={`counterpick-bid-card-${bid.movie_id}`}
    >
      <div className="flex gap-4">
        {/* Movie Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
          <MoviePoster
            src={posterUrl}
            alt=""
            sizes="64px"
            posterSize="w185"
          />
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <h4 className="type-row-title text-foreground break-words">
            {movieTitle}
          </h4>

          <p className="type-body-sm text-foreground-secondary mt-0.5 flex items-center gap-1">
            <Target className="w-3.5 h-3.5 text-crimson-text" aria-hidden="true" />
            <span className="sr-only">Counterpick </span>vs {bid.target_team?.name || 'Unknown Team'}
          </p>

          <BidAmountAndDeadline
            amount={bid.amount}
            isOutbid={isOutbid}
            responseDeadline={bid.response_deadline}
            processingDeadline={bid.processing_deadline}
            counterWindowClosesAt={counterWindowClosesAt}
          />

          {isOutbid && (
            <div className="type-label flex items-center gap-1.5 mt-2 text-warning">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span>You&apos;ve been outbid!</span>
            </div>
          )}

          {scoreLocked && isPending && (
            <ScoreLockLabel className="type-meta mt-2">
              {isOwner ? 'this bid will be cancelled, uncharged' : 'bids on it will be cancelled'}
            </ScoreLockLabel>
          )}
        </div>

        {/* Actions */}
        {(showRecoverButton || showRaiseButton || showCancelButton || showCancelLock) && (
          <div className="flex flex-col items-end gap-2">
            {showRecoverButton && (
              <button
                type="button"
                onClick={onCounter}
                className="type-control btn btn-danger px-4"
                aria-label={`Counter bid on ${movieTitle}`}
              >
                Counter bid
              </button>
            )}

            {showRaiseButton && (
              <button
                type="button"
                onClick={onCounter}
                className="type-control btn btn-secondary px-4 border-crimson text-crimson-text hover:bg-crimson/10"
                data-testid={isOwner ? `raise-counterpick-bid-${bid.movie_id}` : `counter-counterpick-bid-${bid.movie_id}`}
                aria-label={`${isOwner ? 'Raise bid' : 'Counter bid'} on ${movieTitle}`}
              >
                {isOwner ? 'Raise bid' : 'Counter bid'}
              </button>
            )}

            {showCancelButton && (
              <button
                type="button"
                onClick={onCancel}
                data-testid={`cancel-counterpick-bid-${bid.movie_id}`}
                className="type-control btn btn-ghost text-crimson-text hover:text-crimson-text-hover hover:bg-crimson/10"
                aria-label={`Cancel counterpick bid on ${movieTitle}`}
              >
                <Trash2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                Cancel
              </button>
            )}

            {showCancelLock && (
              <p
                className="type-meta flex items-center gap-1.5 text-foreground-secondary px-2"
                data-testid={`counterpick-bid-locked-${bid.movie_id}`}
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                Locked in
                <span className="sr-only">: bids can&apos;t be cancelled after the new-bid cutoff</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
