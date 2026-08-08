'use client'

import Image from 'next/image'
import { AlertTriangle, Film, Trash2, Target } from 'lucide-react'
import type { CounterpickBid } from '@/types'
import BidAmountAndDeadline from './BidAmountAndDeadline'
import { getTmdbPosterUrl, getBidTypeClass } from './utils'

interface CounterpickBidCardProps {
  bid: CounterpickBid
  isOwner: boolean
  onCancel?: () => void
  onCounter?: () => void
  bidType?: 'pickup' | 'counterpick'
  /**
   * When another bid on the same movie still has an open counter-response
   * window, processing of the whole group is held until it closes. Set to that
   * window's end so the card explains the delay instead of "Processing soon".
   */
  counterWindowClosesAt?: string | null
}

export default function CounterpickBidCard({ bid, isOwner, onCancel, onCounter, bidType, counterWindowClosesAt }: CounterpickBidCardProps) {
  const isOutbid = bid.status === 'outbid'
  const isActive = bid.status === 'active'
  const movieTitle = bid.movies?.title || 'Unknown Movie'
  const posterUrl = bid.movies?.poster_url || null

  const typeClass = getBidTypeClass(bidType)

  // An outbid bid gets a prominent "Counter Bid" prompt; an active one gets a
  // quieter option to raise your own bid or outbid a rival's.
  const showRecoverButton = isOutbid && isOwner && !!onCounter
  const showRaiseButton = isActive && !!onCounter
  const showCancelButton = isOwner && isActive && !!onCancel

  return (
    <div
      className={`card bid-card-interactive p-4 ${typeClass} ${
        isOutbid ? 'border-warning bg-warning-bg/20 outbid-pulse' : ''
      }`}
      data-testid={`counterpick-bid-card-${bid.movie_id}`}
    >
      <div className="flex gap-4">
        {/* Movie Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
          {posterUrl ? (
            <Image
              src={getTmdbPosterUrl(posterUrl, 'w92')!}
              alt={movieTitle}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-6 h-6 text-foreground-muted" />
            </div>
          )}
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground truncate">
            {movieTitle}
          </h4>

          <p className="text-sm text-foreground-secondary mt-0.5 flex items-center gap-1">
            <Target className="w-3.5 h-3.5 text-crimson" />
            vs {bid.target_team?.name || 'Unknown Team'}
          </p>

          <BidAmountAndDeadline
            amount={bid.amount}
            isOutbid={isOutbid}
            responseDeadline={bid.response_deadline}
            processingDeadline={bid.processing_deadline}
            counterWindowClosesAt={counterWindowClosesAt}
          />

          {isOutbid && (
            <div className="flex items-center gap-1.5 mt-2 text-warning text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>You&apos;ve been outbid!</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {(showRecoverButton || showRaiseButton || showCancelButton) && (
          <div className="flex flex-col items-end gap-2">
            {showRecoverButton && (
              <button
                onClick={onCounter}
                className="btn btn-danger text-sm px-4"
              >
                Counter Bid
              </button>
            )}

            {showRaiseButton && (
              <button
                onClick={onCounter}
                className="btn btn-secondary text-sm px-4 border-crimson text-crimson hover:bg-crimson/10"
                data-testid={isOwner ? `raise-counterpick-bid-${bid.movie_id}` : `counter-counterpick-bid-${bid.movie_id}`}
              >
                {isOwner ? 'Raise Bid' : 'Counter Bid'}
              </button>
            )}

            {showCancelButton && (
              <button
                onClick={onCancel}
                className="btn btn-ghost text-sm text-crimson hover:text-crimson-hover hover:bg-crimson/10"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
