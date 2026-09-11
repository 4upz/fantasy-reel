'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { AlertTriangle, Film, Lock, Scissors, Trash2, X } from 'lucide-react'
import type { PickupBid } from '@/types'
import BidAmountAndDeadline from './BidAmountAndDeadline'
import BidSummary from './BidSummary'
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
  /**
   * Title of the movie this bid drops if it wins, or null when it carries no
   * conditional drop. Only ever set for the bid's own team.
   */
  dropTitle?: string | null
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
          <h2 id="cancel-bid-title" className="type-section text-foreground">
            Cancel bid
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
                <p className="type-row-title text-foreground break-words">
                  {movieTitle}
                </p>
                <p className="type-number bid-amount-display">
                  ${bidAmount}
                </p>
              </div>
            </div>
          </div>

          <p className="type-body-sm text-foreground-secondary mb-4">
            ${bidAmount} will be returned to your budget.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="btn btn-ghost flex-1"
            >
              Keep bid
            </button>
            <button
              onClick={() => {
                onConfirm()
                onClose()
              }}
              className="btn btn-danger flex-1"
              data-testid="confirm-cancel-bid"
            >
              Cancel bid
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** @design-system League */
export default function BidCard({ bid, isOwner, onCancel, cancelLocked, onCounter, bidType, counterWindowClosesAt, dropTitle }: BidCardProps) {
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

  // An outbid bid gets a prominent "Counter bid" prompt; an active one gets a
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
          <BidSummary
            title={movieTitle}
            posterUrl={getTmdbPosterUrl(movieData?.poster_url ?? null, 'w92')}
            releaseDate={movieData?.release_date}
          >
            <BidAmountAndDeadline
              amount={bid.amount}
              isOutbid={isOutbid}
              responseDeadline={bid.response_deadline}
              processingDeadline={bid.processing_deadline}
              counterWindowClosesAt={counterWindowClosesAt}
            />

            {dropTitle && (
              <span
                className="type-meta inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-warning-bg/30 text-warning border border-warning/20"
                data-testid="conditional-drop-chip"
              >
                <Scissors className="w-3 h-3 shrink-0" />
                <span className="truncate">Drops {dropTitle} if won</span>
              </span>
            )}

            {isOutbid && (
              <div className="type-label flex items-center gap-1.5 mt-2 text-warning">
                <AlertTriangle className="w-4 h-4" />
                <span>You&apos;ve been outbid!</span>
              </div>
            )}
          </BidSummary>

          {/* Actions */}
          {(showRecoverButton || showRaiseButton || showCancelButton || showCancelLock) && (
            <div className="flex flex-col items-end gap-2">
              {showRecoverButton && (
                <button
                  onClick={onCounter}
                  className="type-control btn btn-primary px-4"
                  data-testid={`counter-bid-${bid.tmdb_id}`}
                >
                  Counter bid
                </button>
              )}

              {showRaiseButton && (
                <button
                  onClick={onCounter}
                  className="type-control btn btn-secondary px-4"
                  data-testid={isOwner ? `raise-bid-${bid.tmdb_id}` : `counter-bid-${bid.tmdb_id}`}
                >
                  {isOwner ? 'Raise bid' : 'Counter bid'}
                </button>
              )}

              {showCancelButton && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="type-control btn btn-ghost text-crimson hover:text-crimson-hover hover:bg-crimson/10"
                  data-testid={`cancel-bid-${bid.tmdb_id}`}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Cancel
                </button>
              )}

              {showCancelLock && (
                <p
                  className="type-meta flex items-center gap-1.5 text-foreground-secondary px-2"
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
