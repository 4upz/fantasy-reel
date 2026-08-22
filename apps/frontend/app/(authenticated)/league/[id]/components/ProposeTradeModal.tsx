'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Image from 'next/image'
import { formatCriticScore, formatFantasyPoints } from '@/utils/scoring'
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
import CounterpickMark from './CounterpickMark'

/** Stable empty set so a modal with no rejected rows doesn't allocate one per render. */
const EMPTY_INVALID: ReadonlySet<string> = new Set<string>()

interface Props {
  team: Team
  otherTeams: { id: string; name: string; avatar_url: string | null }[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  onClose: () => void
  onPropose: (
    recipientTeamId: string,
    offeredItems: TradeItems,
    requestedItems: TradeItems,
    message?: string
  ) => Promise<TradeActionResult>
}

/**
 * Focus trap hook - keeps focus within modal
 */
function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Focus first element on mount
    firstElement?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement?.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement?.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [isActive])

  return containerRef
}

export default function ProposeTradeModal({
  team,
  otherTeams,
  tradeableMovies,
  budget,
  onClose,
  onPropose,
}: Props) {
  const [step, setStep] = useState<'select-team' | 'select-items'>('select-team')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [recipientMovies, setRecipientMovies] = useState<TradeableMovie[]>([])
  const [recipientBudget, setRecipientBudget] = useState<TeamBudget | null>(null)
  const [isLoadingRecipient, setIsLoadingRecipient] = useState(false)

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
  const modalRef = useFocusTrap(true)

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Fetch recipient's tradeable movies when team is selected
  useEffect(() => {
    if (!selectedTeamId) return

    const fetchRecipientMovies = async () => {
      setIsLoadingRecipient(true)
      try {
        setRecipientMovies(await fetchTradeableMovies(supabase, selectedTeamId))

        // Fetch recipient budget
        const { data: budgetData } = await supabase
          .from('team_budgets')
          .select('*')
          .eq('team_id', selectedTeamId)
          .single()

        setRecipientBudget(budgetData)
      } catch (err) {
        console.error('Error fetching recipient movies:', err)
      } finally {
        setIsLoadingRecipient(false)
      }
    }

    fetchRecipientMovies()
  }, [selectedTeamId, supabase])

  const selectedTeam = otherTeams.find((t) => t.id === selectedTeamId)

  const handleSelectTeam = (teamId: string) => {
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

  const submitTradeAction = useCallback(async () => {
    if (!selectedTeamId) return

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

    const result = await onPropose(
      selectedTeamId,
      offeredItems,
      requestedItems,
      message.trim() || undefined
    )

    if (!result.success) {
      setError(result.error || 'Failed to propose trade')
      setInvalidSourceIds(new Set(result.invalidSourceIds ?? []))
    }
  }, [selectedTeamId, tradeableMovies, offeredMovies, offeredBudget, recipientMovies, requestedMovies, requestedBudget, message, onPropose])

  const { execute: handleSubmit, isLoading } = useAsyncAction(submitTradeAction)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="propose-trade-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 id="propose-trade-title" className="text-lg font-display font-bold text-foreground">
            {step === 'select-team' ? 'Select Trade Partner' : `Trade with ${selectedTeam?.name}`}
          </h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Close trade proposal"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select-team' ? (
            <div className="space-y-2">
              <p id="team-selection-label" className="text-sm text-foreground-secondary mb-4">
                Choose a team to trade with:
              </p>
              <div role="listbox" aria-labelledby="team-selection-label">
                {otherTeams.map((otherTeam) => (
                  <button
                    key={otherTeam.id}
                    onClick={() => handleSelectTeam(otherTeam.id)}
                    className="w-full card-interactive p-4 flex items-center gap-3 text-left mb-2"
                    role="option"
                    aria-selected={selectedTeamId === otherTeam.id}
                  >
                    <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center overflow-hidden">
                      {otherTeam.avatar_url ? (
                        <Image
                          src={otherTeam.avatar_url}
                          alt=""
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-foreground-muted" aria-hidden="true">
                          {otherTeam.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="font-medium text-foreground">{otherTeam.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Back button */}
              <button
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
                className="text-sm text-gold hover:text-gold-hover transition-colors"
              >
                ← Change trade partner
              </button>

              {/* Your side */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  You give ({team.name})
                </h3>
                <MovieSelector
                  movies={tradeableMovies}
                  selectedIds={offeredMovies}
                  onToggle={toggleOfferedMovie}
                  invalidIds={invalidSourceIds}
                />
                <div className="mt-3">
                  <label className="text-sm text-foreground-secondary">
                    Budget (max ${budget?.remaining_budget ?? 0})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={budget?.remaining_budget ?? 0}
                    value={offeredBudget}
                    onChange={(e) => setOfferedBudget(Math.max(0, parseInt(e.target.value) || 0))}
                    className="input mt-1 w-24"
                  />
                </div>
              </div>

              {/* Their side */}
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  You receive ({selectedTeam?.name})
                </h3>
                {isLoadingRecipient ? (
                  <MovieSelectorSkeleton />
                ) : (
                  <>
                    <MovieSelector
                      movies={recipientMovies}
                      selectedIds={requestedMovies}
                      onToggle={toggleRequestedMovie}
                      invalidIds={invalidSourceIds}
                    />
                    <div className="mt-3">
                      <label className="text-sm text-foreground-secondary">
                        Budget (max ${recipientBudget?.remaining_budget ?? 0})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={recipientBudget?.remaining_budget ?? 0}
                        value={requestedBudget}
                        onChange={(e) =>
                          setRequestedBudget(Math.max(0, parseInt(e.target.value) || 0))
                        }
                        className="input mt-1 w-24"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Message */}
              <div>
                <label className="text-sm text-foreground-secondary">
                  Message (optional)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input mt-1 w-full h-20 resize-none"
                  placeholder="Add a note to your trade proposal..."
                />
              </div>

              {error && (
                <div className="alert alert-error">
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
              onClick={onClose}
              className="btn btn-ghost"
              aria-label="Cancel trade proposal"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hasItems || isLoading}
              className="btn btn-primary"
              aria-label={isLoading ? 'Proposing trade...' : 'Submit trade proposal'}
              aria-busy={isLoading}
            >
              {isLoading ? 'Proposing...' : 'Propose Trade'}
            </button>
          </div>
        )}
      </div>
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

interface MovieSelectorProps {
  movies: TradeableMovie[]
  selectedIds: Set<string>
  onToggle: (sourceId: string) => void
  listId?: string
  emptyMessage?: string
  /** Items the server rejected on the last submit. */
  invalidIds?: ReadonlySet<string>
}

function MovieSelector({
  movies,
  selectedIds,
  onToggle,
  listId = 'movie-list',
  emptyMessage,
  invalidIds = EMPTY_INVALID,
}: MovieSelectorProps) {
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (movies.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((prev) => Math.min(prev + 1, movies.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((prev) => Math.max(prev - 1, 0))
          break
        case ' ':
        case 'Enter':
          e.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < movies.length) {
            onToggle(movies[focusedIndex].source_id)
          }
          break
        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(movies.length - 1)
          break
      }
    },
    [movies, focusedIndex, onToggle]
  )

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]')
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusedIndex])

  // Empty state with helpful message (FE#7)
  if (movies.length === 0) {
    const message = emptyMessage || 'No tradeable movies'
    return (
      <div className="card p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-hover flex items-center justify-center">
          <svg
            className="w-6 h-6 text-foreground-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground-secondary mb-1">{message}</p>
        <p className="text-xs text-foreground-muted">
          Draft movies or pick them up during the bidding phase to start trading.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      id={listId}
      aria-label="Select movies to trade"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => focusedIndex === -1 && setFocusedIndex(0)}
      className="space-y-2 max-h-48 overflow-y-auto focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-surface rounded-lg"
    >
      {movies.map((movie, index) => {
        const isSelected = selectedIds.has(movie.source_id)
        const isFocused = focusedIndex === index
        const isInvalid = invalidIds.has(movie.source_id)
        return (
          <div
            key={movie.source_id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onToggle(movie.source_id)}
            className={`w-full p-2 rounded-lg flex items-center gap-3 text-left transition-colors cursor-pointer ${
              isInvalid
                ? 'bg-crimson/15 border border-crimson'
                : isSelected
                  ? 'bg-gold/20 border border-gold'
                  : 'bg-surface-hover hover:bg-elevated border border-transparent'
            } ${isFocused ? 'ring-2 ring-gold ring-offset-2 ring-offset-surface' : ''}`}
          >
            <div className="relative shrink-0">
              {movie.poster_url ? (
                <Image
                  src={movie.poster_url}
                  alt=""
                  width={32}
                  height={48}
                  className="w-8 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-8 h-12 bg-surface rounded flex items-center justify-center">
                  <span className="text-xs text-foreground-muted" aria-hidden="true">?</span>
                </div>
              )}
              {movie.source === 'counterpick' && <CounterpickMark />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{movie.title}</p>
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                {/* The alert above carries the reason; this only says which row
                    it meant, and carries it in text rather than colour alone. */}
                {isInvalid && <span className="font-medium text-crimson">Can&apos;t be traded</span>}
                {movie.source === 'counterpick' && (
                  <span className="text-crimson">
                    {movie.counterpick_target_team_name
                      ? `vs. ${movie.counterpick_target_team_name}`
                      : 'Counterpick'}
                  </span>
                )}
                {movie.release_date && (
                  <span>{new Date(movie.release_date).getFullYear()}</span>
                )}
                {movie.fantasy_points !== null ? (
                  <>
                    <span className={movie.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}>
                      {formatFantasyPoints(movie.fantasy_points)} pts
                    </span>
                    {movie.combined_score !== null && (
                      <span>{formatCriticScore(movie.combined_score)}</span>
                    )}
                  </>
                ) : (
                  <span>Pending</span>
                )}
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                isSelected ? 'border-gold bg-gold' : 'border-border'
              }`}
              aria-hidden="true"
            >
              {isSelected && (
                <svg className="w-3 h-3 text-background" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </div>
        )
      })}
      {/* Screen reader announcement for selection count */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedIds.size} movie{selectedIds.size !== 1 ? 's' : ''} selected
      </div>
    </div>
  )
}
