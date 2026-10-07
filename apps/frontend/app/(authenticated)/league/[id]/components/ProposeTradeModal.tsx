'use client'

import { useState, useEffect, useMemo, useCallback, useId, useRef } from 'react'
import Image from 'next/image'
import { safeAvatarUrl } from '@/utils/avatar'
import Modal from '@/app/components/Modal'
import type {
  Team,
  TradeActionResult,
  TradeItems,
  TradeableMovie,
  TeamBudget,
  TradeMovieItem,
} from '@/types'
import { createClient } from '@/utils/supabase/client'
import { fetchTradeableMovies } from '@/utils/holdings'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import OfferExpiryPicker from './OfferExpiryPicker'
import { useOfferExpiry } from '../hooks/useOfferExpiry'
import type { ExpiryBounds, ResolvedExpiry } from '@/utils/tradeExpiry'
import { DialogCloseButton, TradeBudgetField, TradeMovieChecklist } from './TradeComposerFields'

/** Stable empty set so a modal with no rejected rows doesn't allocate one per render. */
const EMPTY_INVALID: ReadonlySet<string> = new Set<string>()

interface Props {
  team: Team
  otherTeams: { id: string; name: string; avatar_url: string | null }[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  /** The league's offer-window rules, derived once in TradingClient. */
  expiryBounds: ExpiryBounds
  onClose: () => void
  onPropose: (
    recipientTeamId: string,
    offeredItems: TradeItems,
    requestedItems: TradeItems,
    message?: string,
    expiry?: ResolvedExpiry
  ) => Promise<TradeActionResult>
}

export default function ProposeTradeModal({
  team,
  otherTeams,
  tradeableMovies,
  budget,
  expiryBounds,
  onClose,
  onPropose,
}: Props) {
  const [step, setStep] = useState<'select-team' | 'select-items'>('select-team')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [recipientMovies, setRecipientMovies] = useState<TradeableMovie[]>([])
  const [recipientBudget, setRecipientBudget] = useState<TeamBudget | null>(null)
  const [isLoadingRecipient, setIsLoadingRecipient] = useState(false)
  const [recipientError, setRecipientError] = useState<string | null>(null)

  // Selected items
  const [offeredMovies, setOfferedMovies] = useState<Set<string>>(new Set())
  const [offeredBudget, setOfferedBudget] = useState(0)
  const [requestedMovies, setRequestedMovies] = useState<Set<string>>(new Set())
  const [requestedBudget, setRequestedBudget] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * Items the server rejected, so the rows can say which ones the error is
   * about. Cleared on every submit -- a stale mark on a row the user has since
   * deselected would be worse than no mark at all.
   */
  const [invalidSourceIds, setInvalidSourceIds] = useState<ReadonlySet<string>>(EMPTY_INVALID)

  const supabase = useMemo(() => createClient(), [])

  const titleId = useId()
  const teamPromptId = useId()
  const giveHeadingId = useId()
  const receiveHeadingId = useId()
  const messageId = useId()
  const submitHintId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Each step replaces the control that had focus (a team button, or "Change
  // trade partner"), so every step starts at its heading, which also says
  // which partner the dialog is now about.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  // The submit button is disabled while the request runs, which drops focus;
  // a refusal puts it back on the message that explains it.
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  // Fetch recipient's tradeable movies when team is selected
  useEffect(() => {
    if (!selectedTeamId) return
    let cancelled = false

    const fetchRecipientMovies = async () => {
      try {
        const [movies, { data: budgetData, error: budgetError }] = await Promise.all([
          fetchTradeableMovies(supabase, selectedTeamId),
          supabase.from('team_budgets').select('*').eq('team_id', selectedTeamId).maybeSingle(),
        ])
        if (budgetError) throw budgetError
        if (cancelled) return
        setRecipientMovies(movies)
        setRecipientBudget(budgetData)
      } catch {
        if (!cancelled) {
          setRecipientError('Unable to load this team’s roster and budget. Choose a trade partner again to retry.')
        }
      } finally {
        if (!cancelled) setIsLoadingRecipient(false)
      }
    }

    fetchRecipientMovies()
    return () => { cancelled = true }
  }, [selectedTeamId, supabase])

  const selectedTeam = otherTeams.find((t) => t.id === selectedTeamId)

  const handleSelectTeam = (teamId: string) => {
    setRecipientMovies([])
    setRecipientBudget(null)
    setRecipientError(null)
    setIsLoadingRecipient(true)
    setSelectedTeamId(teamId)
    setStep('select-items')
  }

  const toggleOfferedMovie = (sourceId: string) => {
    setOfferedMovies((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const toggleRequestedMovie = (sourceId: string) => {
    setRequestedMovies((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const hasItems =
    offeredMovies.size > 0 ||
    offeredBudget > 0 ||
    requestedMovies.size > 0 ||
    requestedBudget > 0

  // Both sides: the release anchor is the earliest release across the whole
  // deal, not just the proposer's half.
  const offerMovies = useMemo(
    () => [
      ...tradeableMovies.filter((m) => offeredMovies.has(m.source_id)),
      ...recipientMovies.filter((m) => requestedMovies.has(m.source_id)),
    ],
    [tradeableMovies, offeredMovies, recipientMovies, requestedMovies]
  )
  const expiry = useOfferExpiry(offerMovies, expiryBounds)

  const submitTradeAction = useCallback(async () => {
    if (!selectedTeamId || isLoadingRecipient || recipientError) return

    setError(null)
    setInvalidSourceIds(EMPTY_INVALID)

    const offeredItems: TradeItems = {
      movies: tradeableMovies
        .filter((m) => offeredMovies.has(m.source_id))
        .map((m): TradeMovieItem => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: offeredBudget,
    }

    const requestedItems: TradeItems = {
      movies: recipientMovies
        .filter((m) => requestedMovies.has(m.source_id))
        .map((m): TradeMovieItem => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: requestedBudget,
    }

    const resolved = expiry.resolveNow()
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }

    const result = await onPropose(
      selectedTeamId,
      offeredItems,
      requestedItems,
      message.trim() || undefined,
      resolved.expiry
    )

    if (!result.success) {
      setError(result.error || 'Failed to propose trade')
      setInvalidSourceIds(new Set(result.invalidSourceIds ?? []))
    }
  }, [selectedTeamId, isLoadingRecipient, recipientError, tradeableMovies, offeredMovies, offeredBudget, recipientMovies, requestedMovies, requestedBudget, message, expiry, onPropose])

  const { execute: handleSubmit, isLoading } = useAsyncAction(submitTradeAction)

  return (
    <Modal onClose={onClose} preventClose={isLoading} labelledBy={titleId} closeOnBackdrop>
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="type-panel text-foreground">
            {step === 'select-team' ? 'Select Trade Partner' : `Trade with ${selectedTeam?.name}`}
          </h2>
          <DialogCloseButton label="Close trade proposal" onClick={onClose} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select-team' ? (
            <div className="space-y-2">
              <p id={teamPromptId} className="type-body-sm text-foreground-secondary mb-4">
                Choose a team to trade with:
              </p>
              <ul role="list" aria-labelledby={teamPromptId}>
                {otherTeams.map((otherTeam) => {
                  const avatarUrl = safeAvatarUrl(otherTeam.avatar_url)
                  return (
                    <li key={otherTeam.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectTeam(otherTeam.id)}
                        className="w-full card-interactive p-4 flex items-center gap-3 text-left mb-2 cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center overflow-hidden">
                          {avatarUrl ? (
                            <Image
                              src={avatarUrl}
                              alt=""
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="type-label text-foreground-secondary" aria-hidden="true">
                              {otherTeam.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="type-row-title text-foreground">{otherTeam.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Back button */}
              <button
                type="button"
                onClick={() => {
                  setStep('select-team')
                  setSelectedTeamId(null)
                  setOfferedMovies(new Set())
                  setOfferedBudget(0)
                  setRequestedMovies(new Set())
                  setRequestedBudget(0)
                  // The rejection was about this pairing, so it means nothing
                  // once a different partner is chosen.
                  setError(null)
                  setInvalidSourceIds(EMPTY_INVALID)
                }}
                className="type-control text-gold hover:text-gold-hover transition-colors cursor-pointer"
              >
                <span aria-hidden="true">←</span> Change trade partner
              </button>

              {/* Your side */}
              <div>
                <h3 id={giveHeadingId} className="type-label text-foreground mb-3">
                  You give ({team.name})
                </h3>
                <TradeMovieChecklist
                  movies={tradeableMovies}
                  selectedIds={offeredMovies}
                  onToggle={toggleOfferedMovie}
                  labelledBy={giveHeadingId}
                  invalidIds={invalidSourceIds}
                  emptyState={<NoTradeableMovies />}
                />
                <TradeBudgetField
                  side="you give"
                  available={budget ? budget.remaining_budget : null}
                  value={offeredBudget}
                  onChange={setOfferedBudget}
                />
              </div>

              {/* Their side */}
              <div>
                <h3 id={receiveHeadingId} className="type-label text-foreground mb-3">
                  You receive ({selectedTeam?.name})
                </h3>
                {isLoadingRecipient ? (
                  <div role="status" aria-label="Loading trade partner" aria-busy="true">
                    <span className="sr-only">Loading {selectedTeam?.name}&apos;s movies and budget…</span>
                    <div aria-hidden="true">
                      <MovieSelectorSkeleton />
                      <div className="h-5 w-36 skeleton rounded mt-3" />
                      <div className="h-10 w-24 skeleton rounded mt-1" />
                    </div>
                  </div>
                ) : recipientError ? (
                  <p className="alert alert-error" role="alert">{recipientError}</p>
                ) : (
                  <>
                    <TradeMovieChecklist
                      movies={recipientMovies}
                      selectedIds={requestedMovies}
                      onToggle={toggleRequestedMovie}
                      labelledBy={receiveHeadingId}
                      invalidIds={invalidSourceIds}
                      emptyState={<NoTradeableMovies />}
                    />
                    <TradeBudgetField
                      side={`you request from ${selectedTeam?.name ?? 'them'}`}
                      available={recipientBudget ? recipientBudget.remaining_budget : null}
                      value={requestedBudget}
                      onChange={setRequestedBudget}
                    />
                  </>
                )}
              </div>

              {/* Offer expiry */}
              <OfferExpiryPicker
                releaseAnchor={expiry.releaseAnchor}
                value={expiry.choice}
                onChange={expiry.setChoice}
                resolution={expiry.resolution}
                fellBack={expiry.fellBack}
                bounds={expiryBounds}
              />

              {/* Message */}
              <div>
                <label htmlFor={messageId} className="type-label text-foreground-secondary">
                  Message (optional)
                </label>
                <textarea
                  id={messageId}
                  aria-describedby="trade-message-visibility"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1500}
                  className="input mt-1 w-full h-20 resize-none"
                  placeholder="Add a note to your trade proposal..."
                />
                <p id="trade-message-visibility" className="type-meta text-foreground-secondary mt-1">
                  Everyone in the league can see this message.
                </p>
              </div>

              {error && (
                <div ref={errorRef} tabIndex={-1} className="alert alert-error" role="alert">
                  <p>{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'select-items' && (
          <div className="p-4 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              aria-label="Cancel trade proposal"
            >
              Cancel
            </button>
            {!hasItems && (
              <p id={submitHintId} className="sr-only">
                Add at least one movie or some budget to propose a trade.
              </p>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!hasItems || !expiry.resolution.ok || isLoading || isLoadingRecipient || !!recipientError}
              className="btn btn-primary"
              aria-busy={isLoading}
              aria-describedby={hasItems ? undefined : submitHintId}
            >
              {isLoading ? 'Proposing...' : 'Propose trade'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function NoTradeableMovies() {
  return (
    <div className="card p-6 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-hover flex items-center justify-center">
        <svg
          className="w-6 h-6 text-foreground-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
          />
        </svg>
      </div>
      <p className="type-label text-foreground-secondary mb-1">No tradeable movies</p>
      <p className="type-meta text-foreground-secondary">
        Draft movies or pick them up during the bidding phase to start trading.
      </p>
    </div>
  )
}

function MovieSelectorSkeleton() {
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-full p-2 rounded-lg flex items-center gap-3 bg-surface-hover border border-transparent"
        >
          {/* Poster skeleton */}
          <div className="w-8 h-12 skeleton rounded" />
          {/* Text skeletons */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 skeleton rounded w-3/4" />
            <div className="h-3 skeleton rounded w-1/2" />
          </div>
          {/* Checkbox skeleton */}
          <div className="w-5 h-5 skeleton rounded" />
        </div>
      ))}
    </div>
  )
}
