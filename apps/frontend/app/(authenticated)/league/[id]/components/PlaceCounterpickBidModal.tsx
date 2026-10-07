'use client'

import { useState, useEffect, useId, useRef, useMemo, useCallback } from 'react'
import { X, DollarSign, Target, ArrowLeft } from 'lucide-react'
import Modal from '@/app/components/Modal'
import MoviePoster from '@/app/components/MoviePoster'
import type { TeamBudget, CounterpickBid, CounterpickOption } from '@/types'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { formatReleaseDateFull } from './utils'
import CounterpickPicker from './CounterpickPicker'

interface PlaceCounterpickBidModalProps {
  isOpen: boolean
  /**
   * Closes the dialog. After a successful bid it carries the confirmation, so
   * the opener can show it once the dialog -- and the page's inertness -- is gone.
   */
  onClose: (successMessage?: string) => void
  leagueId: string
  teamId: string
  budget: TeamBudget | null
  counterpickBids: CounterpickBid[]
  onPlaceCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  counterTarget?: CounterpickBid | null
}

// Quick bid amount buttons for common values
const QUICK_BID_AMOUNTS = [0, 5, 10, 25, 50]

function getModalTitle(
  counterTarget: CounterpickBid | null | undefined,
  teamId: string,
  step: 1 | 2,
): string {
  if (counterTarget) {
    return counterTarget.team_id === teamId ? 'Raise your bid' : 'Counter Counterpick Bid'
  }
  return step === 2 ? 'Set your bid' : 'Place counterpick bid'
}

function getValidationErrorMessage(bidAmount: number, remainingBudget: number | null, highestBid: number | null): string {
  if (remainingBudget === null) return 'Your budget is unavailable. Close this dialog and try again.'
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

/** The movie a counter bid is aimed at, pre-selected so the dialog opens on its amount. */
function movieFromTarget(counterTarget: CounterpickBid | null | undefined): SelectedMovieInfo | null {
  if (!counterTarget) return null
  return {
    movieId: counterTarget.movie_id,
    title: counterTarget.movies?.title || 'Unknown Movie',
    posterUrl: counterTarget.movies?.poster_url || null,
    releaseDate: counterTarget.movies?.release_date || null,
    targetTeamName: counterTarget.target_team?.name || 'Unknown Team',
  }
}

/** The smallest amount that takes the lead on a movie. */
function minimumCounter(bids: CounterpickBid[], movieId: string): number {
  return bids
    .filter((bid) => bid.movie_id === movieId && bid.status === 'active')
    .reduce((max, bid) => Math.max(max, bid.amount), 0) + 1
}

/** @design-system Modals */
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
  // Initialized for the first paint, not in an effect: the dialog takes focus
  // as it opens, so a counter bid has to open straight onto its amount step.
  const [step, setStep] = useState<1 | 2>(() => (counterTarget ? 2 : 1))
  const [selectedMovie, setSelectedMovie] = useState<SelectedMovieInfo | null>(() => movieFromTarget(counterTarget))
  const [bidAmount, setBidAmount] = useState(() =>
    counterTarget ? minimumCounter(counterpickBids, counterTarget.movie_id) : 0
  )

  const titleId = useId()
  const descriptionId = useId()
  const amountId = useId()
  const amountHintId = useId()
  const submitErrorId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)

  // Find highest active bid for the selected movie
  const highestBid = useMemo(() => {
    if (!selectedMovie) return null
    const activeBids = counterpickBids.filter(
      b => b.movie_id === selectedMovie.movieId && b.status === 'active'
    )
    if (activeBids.length === 0) return null
    return Math.max(...activeBids.map(b => b.amount))
  }, [counterpickBids, selectedMovie])

  // Bids refresh in realtime while the dialog is open. Read them through a ref
  // so a refresh revalidates the amount below without resetting the step, the
  // chosen movie or the amount being typed.
  const counterpickBidsRef = useRef(counterpickBids)
  counterpickBidsRef.current = counterpickBids

  const submitBidAction = useCallback(async () => {
    if (!selectedMovie || !budget) return

    const { success, error } = await onPlaceCounterpickBid(selectedMovie.movieId, bidAmount)

    // A toast would be hidden behind the open dialog, so the error is shown
    // inline and the dialog stays open to try again.
    if (!success) throw new Error(error || 'Failed to place counterpick bid')

    onClose(`Counterpick bid of $${bidAmount} placed on ${selectedMovie.title}`)
  }, [selectedMovie, budget, bidAmount, onPlaceCounterpickBid, onClose])

  // A submit error is about the bid that was sent. Choosing another movie or
  // amount clears it, so a stale error is never shown against the next bid.
  const {
    execute: submitBid,
    isLoading: isSubmitting,
    error: submitError,
    reset: resetSubmitError,
  } = useAsyncAction(submitBidAction)

  // State is initialized on mount. Reset only when the dialog is reopened or
  // retargeted without remounting.
  const openedFor = useRef({ isOpen, counterTarget })
  useEffect(() => {
    const previous = openedFor.current
    openedFor.current = { isOpen, counterTarget }
    if (!isOpen || (previous.isOpen && previous.counterTarget === counterTarget)) return

    setSelectedMovie(movieFromTarget(counterTarget))
    setBidAmount(counterTarget ? minimumCounter(counterpickBidsRef.current, counterTarget.movie_id) : 0)
    setStep(counterTarget ? 2 : 1)
    resetSubmitError()
  }, [isOpen, counterTarget, resetSubmitError])

  // Choosing a movie or going back swaps the step and unmounts the control
  // that had focus. Step 2 starts at the amount; step 1's picker loads its
  // options again, so focus waits on the dialog heading.
  const pendingFocus = useRef(false)
  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    const input = amountInputRef.current
    if (step === 2 && input && !input.disabled) input.focus()
    else titleRef.current?.focus()
  }, [step])

  const handlePickerSelect = useCallback(async (_movieId: string, option: CounterpickOption) => {
    pendingFocus.current = true
    resetSubmitError()
    setSelectedMovie({
      movieId: option.movie_id,
      title: option.movie_title,
      posterUrl: option.poster_url,
      releaseDate: option.release_date,
      targetTeamName: option.owner_team_name,
    })
    setBidAmount(0)
    setStep(2)
  }, [resetSubmitError])

  const backToPicker = () => {
    pendingFocus.current = true
    resetSubmitError()
    setStep(1)
    setSelectedMovie(null)
  }

  const remainingBudget = budget?.remaining_budget ?? null
  const isValidBid = useMemo(() => {
    if (remainingBudget === null || bidAmount < 0 || bidAmount > remainingBudget || bidAmount > 100) return false
    if (highestBid !== null && bidAmount <= highestBid) return false
    return true
  }, [bidAmount, remainingBudget, highestBid])

  // The button stays focusable while unavailable (aria-disabled), so a
  // keyboard user keeps their place and hears why; the click is ignored.
  const handleSubmit = () => {
    if (!isValidBid || isSubmitting) return
    void submitBid().catch(() => { /* Shown inline as submitError. */ })
  }

  const changeBidAmount = (amount: number) => {
    resetSubmitError()
    setBidAmount(amount)
  }

  if (!isOpen) return null

  return (
    <Modal onClose={onClose} preventClose={isSubmitting} labelledBy={titleId} describedBy={descriptionId}>
      <div
        className="glass modal-panel max-w-2xl w-full max-h-[85dvh] overflow-y-auto overscroll-contain rounded-2xl border border-border shadow-heavy [overflow-wrap:anywhere] motion-reduce:animate-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-[min(1.25rem,20px)] border-b border-border">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {step === 2 && !counterTarget && (
              <button
                type="button"
                onClick={backToPicker}
                className="btn btn-ghost shrink-0 p-[8px] -ml-[8px]"
                aria-label="Back to movie selection"
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              {/* Step 1's picker is still loading as the dialog opens, so its
                  title takes focus first. */}
              <h2
                ref={titleRef}
                id={titleId}
                tabIndex={-1}
                className="type-panel break-words text-foreground focus:outline-none"
                data-dialog-initial-focus={counterTarget ? undefined : true}
              >
                {getModalTitle(counterTarget, teamId, step)}
              </h2>
              <p id={descriptionId} className="type-body-sm text-foreground-secondary mt-0.5">
                {step === 2
                  ? 'Choose your bid amount'
                  : 'Select an opponent movie to counterpick'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={isSubmitting}
            className="btn btn-ghost min-h-[44px] min-w-[44px] shrink-0 p-[8px] hover:bg-surface-hover rounded-full"
            aria-label="Close counterpick bid dialog"
          >
            <X className="w-[20px] h-[20px]" aria-hidden="true" />
          </button>
        </div>

        {/* Budget display */}
        <div className="px-[min(1.25rem,20px)] py-3 bg-elevated/30 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-body-sm text-foreground-secondary">Available budget</span>
            <span className="type-number bid-amount-display whitespace-nowrap">
              {remainingBudget === null ? 'Unavailable' : `$${remainingBudget}`}
            </span>
          </div>
        </div>

        {/* One scroll region keeps content and actions reachable with enlarged text. */}
        <div className="min-w-0">
          {step === 1 ? (
            <div className="p-[min(1.25rem,20px)]">
              <CounterpickPicker
                leagueId={leagueId}
                teamId={teamId}
                isMyTurn={true}
                isPicking={false}
                onPick={handlePickerSelect}
                lockScored
              />
            </div>
          ) : selectedMovie ? (
            <div className="p-[min(1.25rem,20px)]">
              {/* Selected Movie Card */}
              <div className="card p-[min(1rem,16px)] mb-6 bg-surface/50">
                <div className="flex flex-wrap gap-4">
                  <div className="relative w-[min(6rem,96px)] aspect-[2/3] flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-medium">
                    <MoviePoster
                      src={selectedMovie.posterUrl}
                      alt=""
                      sizes="96px"
                      posterSize="w342"
                    />
                  </div>
                  <div className="flex-1 min-w-[min(100%,8rem)]">
                    <h3 className="type-card break-words text-foreground">
                      {selectedMovie.title}
                    </h3>
                    <p className="text-foreground-secondary mt-1 flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-crimson-text" aria-hidden="true" />
                      <span className="sr-only">Counterpick </span>vs {selectedMovie.targetTeamName}
                    </p>
                    {selectedMovie.releaseDate && (
                      <p className="type-body-sm text-foreground-secondary mt-1">
                        {formatReleaseDateFull(selectedMovie.releaseDate)}
                      </p>
                    )}
                    {highestBid !== null && (
                      <div className="mt-3 px-3 py-1.5 bg-warning-bg/30 border border-warning/20 rounded-lg inline-flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-warning" aria-hidden="true" />
                        <span className="type-label text-warning">
                          Current high bid: ${highestBid}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bid Amount Section */}
              <div className="space-y-4">
                <label htmlFor={amountId} className="type-label block text-foreground">
                  Your bid amount<span className="sr-only"> in dollars</span>
                </label>

                {/* Quick Amount Buttons */}
                <div className="flex flex-wrap gap-2" role="group" aria-label="Quick bid amounts">
                  {QUICK_BID_AMOUNTS.filter(amt => remainingBudget !== null && amt <= remainingBudget).map(amount => (
                    <button
                      type="button"
                      key={amount}
                      onClick={() => changeBidAmount(amount)}
                      aria-pressed={bidAmount === amount}
                      className={`type-numeric type-control btn px-4 py-2 ${
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
                  <DollarSign className="absolute left-[16px] top-1/2 -translate-y-1/2 w-[24px] h-[24px] text-gold" aria-hidden="true" />
                  <input
                    ref={amountInputRef}
                    id={amountId}
                    type="number"
                    value={bidAmount}
                    onChange={(e) => changeBidAmount(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                    min={0}
                    max={Math.min(100, remainingBudget ?? 0)}
                    disabled={remainingBudget === null}
                    aria-invalid={!isValidBid}
                    aria-describedby={amountHintId}
                    className={`type-input type-numeric input w-full pl-[56px] py-4 text-center ${
                      !isValidBid ? 'border-error focus:border-error' : 'focus:border-gold'
                    }`}
                    data-testid="counterpick-bid-amount-input"
                    data-dialog-initial-focus={counterTarget ? true : undefined}
                  />
                </div>

                {/* An invalid amount is an alert so it is heard as it appears;
                    the hint that replaces it is plain text read on focus. */}
                {!isValidBid ? (
                  <p id={amountHintId} className="type-body-sm text-error flex items-center gap-1.5" role="alert">
                    {getValidationErrorMessage(bidAmount, remainingBudget, highestBid)}
                  </p>
                ) : (
                  <p id={amountHintId} className="type-body-sm text-foreground-secondary">
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
          <div className="p-[min(1.25rem,20px)] border-t border-border bg-elevated/30">
            {submitError && (
              <p id={submitErrorId} role="alert" className="alert alert-error type-body-sm mb-3">
                {submitError}
              </p>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              aria-disabled={!isValidBid || isSubmitting}
              aria-describedby={submitError ? `${amountHintId} ${submitErrorId}` : amountHintId}
              className="btn btn-primary w-full py-3 text-base font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-gold aria-disabled:hover:shadow-none"
              data-testid="submit-counterpick-bid-button"
            >
              {isSubmitting ? (
                <span className="flex min-w-0 flex-wrap items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-foreground-inverse border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  Placing Bid...
                </span>
              ) : (
                <span className="flex min-w-0 flex-wrap items-center justify-center gap-2">
                  <Target className="w-5 h-5" aria-hidden="true" />
                  Place ${bidAmount} Counterpick Bid
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
