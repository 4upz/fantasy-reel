'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Modal from '@/app/components/Modal'
import MoviePoster from '@/app/components/MoviePoster'
import { AlertTriangle, Lock, Scissors, Trash2, X } from 'lucide-react'
import type { PickupBid } from '@/types'
import BidAmountAndDeadline from './BidAmountAndDeadline'
import BidSummary from './BidSummary'
import { getBidTypeClass } from './utils'
import ScoreLockLabel from '@/app/components/ScoreLockLabel'

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
  /** The movie got its score while the bid was pending: processing will cancel it, uncharged. */
  scoreLocked?: boolean
}

interface CancelBidModalProps {
  onClose: () => void
  onConfirm: () => void
  movieTitle: string
  moviePoster: string | null
  bidAmount: number
}

function CancelBidModal({
  onClose,
  onConfirm,
  movieTitle,
  moviePoster,
  bidAmount,
}: CancelBidModalProps) {
  const titleId = useId()
  const questionId = useId()
  const movieId = useId()

  return (
    <Modal onClose={onClose} labelledBy={titleId} describedBy={`${questionId} ${movieId}`}>
      <div className="glass modal-panel max-w-sm w-full rounded-xl border border-border shadow-heavy motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 id={titleId} className="type-section text-foreground">
            Cancel bid
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost p-1.5 rounded-full"
            aria-label="Close cancel bid dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p id={questionId} className="text-foreground-secondary mb-3">
            Are you sure you want to cancel your bid?
          </p>

          <div className="card p-3 mb-4">
            <div className="flex gap-3 items-center">
              <div className="relative w-12 h-18 flex-shrink-0 rounded overflow-hidden bg-elevated">
                <MoviePoster
                  src={moviePoster}
                  alt=""
                  sizes="48px"
                  posterSize="w154"
                />
              </div>
              <div id={movieId} className="flex-1 min-w-0">
                <p className="type-row-title text-foreground break-words">
                  {movieTitle}
                </p>
                <p className="type-number bid-amount-display">
                  <span className="sr-only">Bid: </span>${bidAmount}
                </p>
              </div>
            </div>
          </div>

          <p className="type-body-sm text-foreground-secondary mb-4">
            This bid will no longer be eligible to win.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost flex-1"
              data-dialog-initial-focus
            >
              Keep bid
            </button>
            <button
              type="button"
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
    </Modal>
  )
}

/** @design-system League */
export default function BidCard({ bid, isOwner, onCancel, cancelLocked, onCounter, bidType, counterWindowClosesAt, dropTitle, scoreLocked }: BidCardProps) {
  const [showCancelModal, setShowCancelModal] = useState(false)

  const movieData = bid.movie_data as {
    title?: string
    poster_url?: string
    release_date?: string
  } | null

  const isOutbid = bid.status === 'outbid'
  const isActive = bid.status === 'active'
  const isPending = isActive || isOutbid
  const movieTitle = movieData?.title || `Movie #${bid.tmdb_id}`

  const typeClass = getBidTypeClass(bidType)

  // An outbid bid gets a prominent "Counter bid" prompt; an active one gets a
  // quieter option to raise your own bid or outbid a rival's.
  const showRecoverButton = isOutbid && isOwner && !!onCounter
  const showRaiseButton = isActive && !!onCounter
  const showCancelButton = isOwner && isPending && !!onCancel
  const showCancelLock = isOwner && isPending && !onCancel && !!cancelLocked

  // The bidding page's clock can pass the new-bid cutoff while this card is on
  // screen, taking the Cancel button away. A confirmation left open would then
  // confirm nothing, so close it, and land focus on the note that says why
  // rather than on <body>. The same goes for focus left on the vanished button.
  const lockNoteRef = useRef<HTMLParagraphElement>(null)
  const cancelHasFocus = useRef(false)
  const focusLockNote = useRef(false)
  useEffect(() => {
    if (showCancelButton) return
    if (showCancelModal) {
      // Focus moves once the dialog has unmounted and let go of it.
      focusLockNote.current = true
      setShowCancelModal(false)
      return
    }
    if (focusLockNote.current || cancelHasFocus.current) {
      focusLockNote.current = false
      cancelHasFocus.current = false
      lockNoteRef.current?.focus()
    }
  }, [showCancelButton, showCancelModal])

  return (
    <>
      <div
        className={`card bid-card-interactive p-4 ${typeClass} ${
          isOutbid ? 'border-warning bg-warning-bg/20 outbid-pulse motion-reduce:animate-none' : ''
        }`}
        data-testid={`bid-card-${bid.tmdb_id}`}
      >
        <div className="flex gap-4">
          <BidSummary
            title={movieTitle}
            posterUrl={movieData?.poster_url}
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
                className="type-meta inline-flex max-w-full items-start gap-1 mt-2 px-2 py-0.5 rounded-xl bg-warning-bg/30 text-warning border border-warning/20"
                data-testid="conditional-drop-chip"
              >
                <Scissors className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0 break-words">Drops {dropTitle} if won</span>
              </span>
            )}

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
          </BidSummary>

          {/* Actions */}
          {(showRecoverButton || showRaiseButton || showCancelButton || showCancelLock) && (
            <div className="flex flex-col items-end gap-2">
              {showRecoverButton && (
                <button
                  type="button"
                  onClick={onCounter}
                  className="type-control btn btn-primary px-4"
                  data-testid={`counter-bid-${bid.tmdb_id}`}
                  aria-label={`Counter bid on ${movieTitle}`}
                >
                  Counter bid
                </button>
              )}

              {showRaiseButton && (
                <button
                  type="button"
                  onClick={onCounter}
                  className="type-control btn btn-secondary px-4"
                  data-testid={isOwner ? `raise-bid-${bid.tmdb_id}` : `counter-bid-${bid.tmdb_id}`}
                  aria-label={`${isOwner ? 'Raise bid' : 'Counter bid'} on ${movieTitle}`}
                >
                  {isOwner ? 'Raise bid' : 'Counter bid'}
                </button>
              )}

              {showCancelButton && (
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  onFocus={() => { cancelHasFocus.current = true }}
                  onBlur={() => { cancelHasFocus.current = false }}
                  className="type-control btn btn-ghost text-crimson-text hover:text-crimson-text-hover hover:bg-crimson/10"
                  data-testid={`cancel-bid-${bid.tmdb_id}`}
                  aria-haspopup="dialog"
                  aria-label={`Cancel bid on ${movieTitle}`}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  Cancel
                </button>
              )}

              {showCancelLock && (
                <p
                  ref={lockNoteRef}
                  tabIndex={-1}
                  className="type-meta flex items-center gap-1.5 text-foreground-secondary px-2"
                  data-testid={`bid-locked-${bid.tmdb_id}`}
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

      {showCancelModal && (
        <CancelBidModal
          onClose={() => setShowCancelModal(false)}
          onConfirm={() => onCancel?.()}
          movieTitle={movieTitle}
          moviePoster={movieData?.poster_url || null}
          bidAmount={bid.amount}
        />
      )}
    </>
  )
}
