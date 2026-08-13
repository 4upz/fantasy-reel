'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { AlertTriangle, Film, Lock, Trash2, X } from 'lucide-react'
import type { PickupBid } from '@/types'
import BidAmountAndDeadline from './BidAmountAndDeadline'
import { getTmdbPosterUrl, getBidTypeClass } from './utils'

interface BidCardProps {
  bid: PickupBid
  isOwner: boolean
  onCancel?: () => void
  /**
   * True once the new-bid cutoff has passed on this team's own bid: the bid is
   * committed for the week and the server will refuse a cancel. Shown as a
   * short note rather than a disabled button -- the action isn't temporarily
   * unavailable, it's gone until bids process.
   */
  cancelLocked?: boolean
  onCounter?: () => void
  bidType?: 'pickup' | 'counterpick'
  /**
   * When another bid on the same movie still has an open counter-response
   * window, processing of the whole group is held until it closes. Set to that
   * window's end so the card explains the delay instead of "Processing soon".
   */
  counterWindowClosesAt?: string | null
}

interface CancelBidModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  movieTitle: string
  moviePoster: string | null
  bidAmount: number
}

function CancelBidModal({
  isOpen,
  onClose,
  onConfirm,
  movieTitle,
  moviePoster,
  bidAmount,
}: CancelBidModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

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

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-bid-title"
        className="glass modal-panel max-w-sm w-full mx-4 rounded-xl border border-border shadow-heavy"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id="cancel-bid-title" className="font-display text-lg font-semibold text-foreground">
            Cancel Bid
          </h2>
          <button
            onClick={onClose}
            className="btn btn-ghost p-1.5 rounded-full"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-foreground-secondary mb-3">
            Are you sure you want to cancel your bid?
          </p>

          <div className="card p-3 mb-4">
            <div className="flex gap-3 items-center">
              <div className="relative w-12 h-18 flex-shrink-0 rounded overflow-hidden bg-elevated">
                {moviePoster ? (
                  <Image
                    src={getTmdbPosterUrl(moviePoster, 'w92')!}
                    alt={movieTitle}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-5 h-5 text-foreground-muted" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display font-semibold text-foreground truncate">
                  {movieTitle}
                </p>
                <p className="bid-amount-display text-lg">
                  ${bidAmount}
                </p>
              </div>
            </div>
          </div>

          <p className="text-foreground-muted text-sm mb-4">
            ${bidAmount} will be returned to your budget.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="btn btn-ghost flex-1"
            >
              Keep Bid
            </button>
            <button
              onClick={() => {
                onConfirm()
                onClose()
              }}
              className="btn btn-danger flex-1"
              data-testid="confirm-cancel-bid"
            >
              Cancel Bid
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BidCard({ bid, isOwner, onCancel, cancelLocked, onCounter, bidType, counterWindowClosesAt }: BidCardProps) {
  const [showCancelModal, setShowCancelModal] = useState(false)

  const movieData = bid.movie_data as {
    title?: string
    poster_url?: string
    release_date?: string
  } | null

  const isOutbid = bid.status === 'outbid'
  const isActive = bid.status === 'active'
  const movieTitle = movieData?.title || `Movie #${bid.tmdb_id}`

  const typeClass = getBidTypeClass(bidType)

  // An outbid bid gets a prominent "Counter Bid" prompt; an active one gets a
  // quieter option to raise your own bid or outbid a rival's.
  const showRecoverButton = isOutbid && isOwner && !!onCounter
  const showRaiseButton = isActive && !!onCounter
  const showCancelButton = isOwner && isActive && !!onCancel
  const showCancelLock = isOwner && isActive && !onCancel && !!cancelLocked

  return (
    <>
      <div
        className={`card bid-card-interactive p-4 ${typeClass} ${
          isOutbid ? 'border-warning bg-warning-bg/20 outbid-pulse' : ''
        }`}
        data-testid={`bid-card-${bid.tmdb_id}`}
      >
        <div className="flex gap-4">
          {/* Movie Poster */}
          <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
            {movieData?.poster_url ? (
              <Image
                src={getTmdbPosterUrl(movieData.poster_url, 'w92')!}
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

            {movieData?.release_date && (
              <p className="text-sm text-foreground-secondary mt-0.5">
                {new Date(movieData.release_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}

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
          {(showRecoverButton || showRaiseButton || showCancelButton || showCancelLock) && (
            <div className="flex flex-col items-end gap-2">
              {showRecoverButton && (
                <button
                  onClick={onCounter}
                  className="btn btn-primary text-sm px-4"
                  data-testid={`counter-bid-${bid.tmdb_id}`}
                >
                  Counter Bid
                </button>
              )}

              {showRaiseButton && (
                <button
                  onClick={onCounter}
                  className="btn btn-secondary text-sm px-4"
                  data-testid={isOwner ? `raise-bid-${bid.tmdb_id}` : `counter-bid-${bid.tmdb_id}`}
                >
                  {isOwner ? 'Raise Bid' : 'Counter Bid'}
                </button>
              )}

              {showCancelButton && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="btn btn-ghost text-sm text-crimson hover:text-crimson-hover hover:bg-crimson/10"
                  data-testid={`cancel-bid-${bid.tmdb_id}`}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Cancel
                </button>
              )}

              {showCancelLock && (
                <p
                  className="flex items-center gap-1.5 text-xs text-foreground-muted px-2"
                  data-testid={`bid-locked-${bid.tmdb_id}`}
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  Locked in
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <CancelBidModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={() => onCancel?.()}
        movieTitle={movieTitle}
        moviePoster={movieData?.poster_url || null}
        bidAmount={bid.amount}
      />
    </>
  )
}
