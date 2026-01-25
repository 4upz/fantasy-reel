'use client'

import { useState } from 'react'
import Image from 'next/image'
import type {
  TradeOfferWithTeams,
  TradeItems,
  TradeMovieItem,
  TradeableMovie,
  TeamBudget,
} from '@/types'
import { formatRelativeDate } from '@/utils/date'
import AcceptConfirmModal from './AcceptConfirmModal'

interface Props {
  trade: TradeOfferWithTeams
  currentTeamId: string
  isOwner: boolean
  otherTeams: { id: string; name: string; avatar_url: string | null }[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  onRespond: (
    tradeOfferId: string,
    response: 'accept' | 'reject',
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  onCounter: (
    tradeOfferId: string,
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  onCancel: (tradeOfferId: string) => Promise<{ success: boolean; error?: string }>
  onVeto: (
    tradeOfferId: string,
    reason?: string
  ) => Promise<{ success: boolean; error?: string }>
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  proposed: { bg: 'bg-info-bg', text: 'text-info', label: 'Proposed' },
  countered: { bg: 'bg-warning-bg', text: 'text-warning', label: 'Countered' },
  accepted: { bg: 'bg-success-bg', text: 'text-success', label: 'Accepted' },
  review: { bg: 'bg-warning-bg', text: 'text-warning', label: 'In Review' },
  completed: { bg: 'bg-success-bg', text: 'text-success', label: 'Completed' },
  rejected: { bg: 'bg-error-bg', text: 'text-error', label: 'Rejected' },
  cancelled: { bg: 'bg-surface-hover', text: 'text-foreground-muted', label: 'Cancelled' },
  vetoed: { bg: 'bg-error-bg', text: 'text-error', label: 'Vetoed' },
  expired: { bg: 'bg-surface-hover', text: 'text-foreground-muted', label: 'Expired' },
}

export default function TradeOfferCard(props: Props) {
  const {
    trade,
    currentTeamId,
    isOwner,
    // otherTeams - passed for potential future use
    tradeableMovies,
    budget,
    onRespond,
    onCounter,
    onCancel,
    onVeto,
  } = props
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCounterModal, setShowCounterModal] = useState(false)
  const [showVetoModal, setShowVetoModal] = useState(false)
  const [showAcceptModal, setShowAcceptModal] = useState(false)

  const isInitiator = trade.initiator_team_id === currentTeamId
  const isRecipient = trade.recipient_team_id === currentTeamId
  const canRespond = isRecipient && (trade.status === 'proposed' || trade.status === 'countered')
  const canCancel = isInitiator && (trade.status === 'proposed' || trade.status === 'countered')
  const canVeto = isOwner && trade.status === 'review'

  const statusStyle = STATUS_STYLES[trade.status] || STATUS_STYLES.proposed

  const handleAction = async (
    action: 'accept' | 'reject' | 'cancel' | 'veto',
    message?: string
  ) => {
    setIsLoading(true)
    setError(null)

    let result: { success: boolean; error?: string }

    switch (action) {
      case 'accept':
        result = await onRespond(trade.id, 'accept', message)
        break
      case 'reject':
        result = await onRespond(trade.id, 'reject', message)
        break
      case 'cancel':
        result = await onCancel(trade.id)
        break
      case 'veto':
        result = await onVeto(trade.id, message)
        break
      default:
        result = { success: false, error: 'Unknown action' }
    }

    setIsLoading(false)

    if (!result.success && result.error) {
      setError(result.error)
    }
  }

  const initiatorTeam = trade.initiator_team as { id: string; name: string; avatar_url: string | null }
  const recipientTeam = trade.recipient_team as { id: string; name: string; avatar_url: string | null }

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <TeamAvatar team={initiatorTeam} />
            <TeamAvatar team={recipientTeam} />
          </div>
          <div>
            <p className="font-medium text-foreground">
              {initiatorTeam.name} → {recipientTeam.name}
            </p>
            <p className="text-sm text-foreground-muted">
              {formatRelativeDate(trade.proposed_at)}
            </p>
          </div>
        </div>

        <span className={`px-2 py-1 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Trade items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <TradeItemsSection
          title={`${initiatorTeam.name} sends`}
          items={trade.initiator_items as TradeItems}
          isYours={isInitiator}
        />
        <TradeItemsSection
          title={`${recipientTeam.name} sends`}
          items={trade.recipient_items as TradeItems}
          isYours={isRecipient}
        />
      </div>

      {/* Messages */}
      {trade.initiator_message && (
        <div className="mb-4 p-3 bg-surface-hover rounded-lg">
          <p className="text-sm text-foreground-secondary">
            <span className="font-medium">{initiatorTeam.name}:</span> {trade.initiator_message}
          </p>
        </div>
      )}

      {trade.response_message && (
        <div className="mb-4 p-3 bg-surface-hover rounded-lg">
          <p className="text-sm text-foreground-secondary">
            <span className="font-medium">{recipientTeam.name}:</span> {trade.response_message}
          </p>
        </div>
      )}

      {/* Review countdown */}
      {trade.status === 'review' && trade.review_ends_at && (
        <div className="mb-4 p-3 bg-warning-bg rounded-lg">
          <p className="text-sm text-warning">
            Review period ends {formatRelativeDate(trade.review_ends_at)}
          </p>
        </div>
      )}

      {/* Veto reason */}
      {trade.status === 'vetoed' && trade.veto_reason && (
        <div className="mb-4 p-3 bg-error-bg rounded-lg">
          <p className="text-sm text-error">
            <span className="font-medium">Veto reason:</span> {trade.veto_reason}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {/* Actions */}
      {(canRespond || canCancel || canVeto) && (
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
          {canRespond && (
            <>
              <button
                onClick={() => setShowAcceptModal(true)}
                disabled={isLoading}
                className="btn btn-primary"
              >
                {isLoading ? 'Processing...' : 'Accept'}
              </button>
              <button
                onClick={() => setShowCounterModal(true)}
                disabled={isLoading}
                className="btn btn-secondary"
              >
                Counter
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={isLoading}
                className="btn btn-ghost"
              >
                Reject
              </button>
            </>
          )}

          {canCancel && (
            <button
              onClick={() => handleAction('cancel')}
              disabled={isLoading}
              className="btn btn-ghost text-crimson"
            >
              Cancel Trade
            </button>
          )}

          {canVeto && (
            <button
              onClick={() => setShowVetoModal(true)}
              disabled={isLoading}
              className="btn btn-danger"
            >
              Veto Trade
            </button>
          )}
        </div>
      )}

      {/* Counter Trade Modal */}
      {showCounterModal && (
        <CounterTradeModal
          trade={trade}
          currentTeamId={currentTeamId}
          tradeableMovies={tradeableMovies}
          budget={budget}
          onClose={() => setShowCounterModal(false)}
          onCounter={async (counterOfferedItems, counterRequestedItems, message) => {
            setShowCounterModal(false)
            setIsLoading(true)
            setError(null)
            const result = await onCounter(trade.id, counterOfferedItems, counterRequestedItems, message)
            setIsLoading(false)
            if (!result.success && result.error) {
              setError(result.error)
            }
            return result
          }}
        />
      )}

      {/* Veto Modal */}
      {showVetoModal && (
        <VetoModal
          trade={trade}
          onClose={() => setShowVetoModal(false)}
          onVeto={async (reason) => {
            setShowVetoModal(false)
            await handleAction('veto', reason)
          }}
        />
      )}

      {/* Accept Confirmation Modal */}
      {showAcceptModal && (
        <AcceptConfirmModal
          trade={trade}
          currentTeamId={currentTeamId}
          onClose={() => setShowAcceptModal(false)}
          onConfirm={async () => {
            setShowAcceptModal(false)
            await handleAction('accept')
          }}
        />
      )}
    </div>
  )
}

function TeamAvatar({ team }: { team: { name: string; avatar_url: string | null } }) {
  return (
    <div className="w-8 h-8 rounded-full bg-surface-hover border-2 border-background flex items-center justify-center overflow-hidden">
      {team.avatar_url ? (
        <Image
          src={team.avatar_url}
          alt={team.name}
          width={32}
          height={32}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-xs font-medium text-foreground-muted">
          {team.name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}

function TradeItemsSection({
  title,
  items,
  isYours,
}: {
  title: string
  items: TradeItems
  isYours: boolean
}) {
  const hasItems = items.movies.length > 0 || items.faab > 0

  return (
    <div className={`p-3 rounded-lg ${isYours ? 'bg-crimson/10' : 'bg-success/10'}`}>
      <p className="text-sm font-medium text-foreground-secondary mb-2">{title}</p>

      {!hasItems ? (
        <p className="text-sm text-foreground-muted italic">Nothing</p>
      ) : (
        <div className="space-y-2">
          {items.movies.map((movie: TradeMovieItem) => (
            <div key={movie.source_id} className="flex items-center gap-2">
              {movie.poster_url ? (
                <Image
                  src={movie.poster_url}
                  alt={movie.title || 'Movie'}
                  width={32}
                  height={48}
                  className="w-8 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-8 h-12 bg-surface-hover rounded flex items-center justify-center">
                  <span className="text-xs text-foreground-muted">?</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {movie.title || 'Unknown Movie'}
                </p>
                {movie.release_date && (
                  <p className="text-xs text-foreground-muted">
                    {new Date(movie.release_date).getFullYear()}
                  </p>
                )}
              </div>
            </div>
          ))}

          {items.faab > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gold/20 rounded flex items-center justify-center">
                <span className="text-gold font-bold text-sm">$</span>
              </div>
              <p className="text-sm font-medium text-gold">${items.faab} FAAB</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Counter Trade Modal
// =============================================================================

interface CounterTradeModalProps {
  trade: TradeOfferWithTeams
  currentTeamId: string
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  onClose: () => void
  onCounter: (
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
}

function CounterTradeModal(counterProps: CounterTradeModalProps) {
  const {
    trade,
    // currentTeamId - passed for potential future use
    tradeableMovies,
    budget,
    onClose,
    onCounter,
  } = counterProps
  // In a counter, the recipient becomes the new initiator
  // They offer items (what they give) and request items (what they want)
  const existingInitiatorItems = trade.initiator_items as TradeItems
  const existingRecipientItems = trade.recipient_items as TradeItems

  // Pre-populate: what was requested FROM you becomes what you now OFFER
  // What was offered TO you becomes what you now REQUEST
  const [offeredMovies, setOfferedMovies] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    existingRecipientItems.movies.forEach((m) => ids.add(m.source_id))
    return ids
  })
  const [offeredFaab, setOfferedFaab] = useState(existingRecipientItems.faab || 0)

  const [requestedMovies, setRequestedMovies] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    existingInitiatorItems.movies.forEach((m) => ids.add(m.source_id))
    return ids
  })
  const [requestedFaab, setRequestedFaab] = useState(existingInitiatorItems.faab || 0)
  const [message, setMessage] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get the other team's movies from the original trade items
  const otherTeamMovies: TradeableMovie[] = existingInitiatorItems.movies.map((m) => ({
    movie_id: m.movie_id,
    source: m.source,
    source_id: m.source_id,
    title: m.title || 'Unknown',
    poster_url: m.poster_url || null,
    release_date: m.release_date || null,
    combined_score: null,
  }))

  const initiatorTeam = trade.initiator_team as { id: string; name: string }
  const recipientTeam = trade.recipient_team as { id: string; name: string }

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
    offeredMovies.size > 0 || offeredFaab > 0 || requestedMovies.size > 0 || requestedFaab > 0

  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)

    const counterOfferedItems: TradeItems = {
      movies: tradeableMovies
        .filter((m) => offeredMovies.has(m.source_id))
        .map((m) => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: offeredFaab,
    }

    const counterRequestedItems: TradeItems = {
      movies: otherTeamMovies
        .filter((m) => requestedMovies.has(m.source_id))
        .map((m) => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: requestedFaab,
    }

    const result = await onCounter(counterOfferedItems, counterRequestedItems, message.trim() || undefined)

    setIsLoading(false)

    if (!result.success) {
      setError(result.error || 'Failed to submit counter-offer')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-foreground">
            Counter Trade with {initiatorTeam.name}
          </h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground transition-colors">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Your side - what you offer */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">You give ({recipientTeam.name})</h3>
            <MovieSelector
              movies={tradeableMovies}
              selectedIds={offeredMovies}
              onToggle={toggleOfferedMovie}
            />
            <div className="mt-3">
              <label className="text-sm text-foreground-secondary">FAAB (max ${budget?.remaining_budget ?? 0})</label>
              <input
                type="number"
                min={0}
                max={budget?.remaining_budget ?? 0}
                value={offeredFaab}
                onChange={(e) => setOfferedFaab(Math.max(0, parseInt(e.target.value) || 0))}
                className="input mt-1 w-24"
              />
            </div>
          </div>

          {/* Their side - what you request */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">You receive ({initiatorTeam.name})</h3>
            <MovieSelector
              movies={otherTeamMovies}
              selectedIds={requestedMovies}
              onToggle={toggleRequestedMovie}
            />
            <div className="mt-3">
              <label className="text-sm text-foreground-secondary">FAAB</label>
              <input
                type="number"
                min={0}
                max={100}
                value={requestedFaab}
                onChange={(e) => setRequestedFaab(Math.max(0, parseInt(e.target.value) || 0))}
                className="input mt-1 w-24"
              />
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-sm text-foreground-secondary">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input mt-1 w-full h-20 resize-none"
              placeholder="Add a note to your counter-offer..."
            />
          </div>

          {error && (
            <div className="alert alert-error">
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!hasItems || isLoading} className="btn btn-primary">
            {isLoading ? 'Submitting...' : 'Submit Counter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Movie Selector (shared helper)
// =============================================================================

function MovieSelector({
  movies,
  selectedIds,
  onToggle,
}: {
  movies: TradeableMovie[]
  selectedIds: Set<string>
  onToggle: (sourceId: string) => void
}) {
  if (movies.length === 0) {
    return <p className="text-sm text-foreground-muted italic">No movies available</p>
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {movies.map((movie) => {
        const isSelected = selectedIds.has(movie.source_id)
        return (
          <button
            key={movie.source_id}
            onClick={() => onToggle(movie.source_id)}
            className={`w-full p-2 rounded-lg flex items-center gap-3 text-left transition-colors ${
              isSelected
                ? 'bg-gold/20 border border-gold'
                : 'bg-surface-hover hover:bg-elevated border border-transparent'
            }`}
          >
            {movie.poster_url ? (
              <Image
                src={movie.poster_url}
                alt={movie.title}
                width={32}
                height={48}
                className="w-8 h-12 object-cover rounded"
              />
            ) : (
              <div className="w-8 h-12 bg-surface rounded flex items-center justify-center">
                <span className="text-xs text-foreground-muted">?</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{movie.title}</p>
              {movie.release_date && (
                <p className="text-xs text-foreground-muted">{new Date(movie.release_date).getFullYear()}</p>
              )}
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                isSelected ? 'border-gold bg-gold' : 'border-border'
              }`}
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
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// Veto Modal
// =============================================================================

interface VetoModalProps {
  trade: TradeOfferWithTeams
  onClose: () => void
  onVeto: (reason?: string) => Promise<void>
}

function VetoModal({ trade, onClose, onVeto }: VetoModalProps) {
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const initiatorTeam = trade.initiator_team as { name: string }
  const recipientTeam = trade.recipient_team as { name: string }

  const handleVeto = async () => {
    setIsLoading(true)
    await onVeto(reason.trim() || undefined)
    setIsLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-display font-bold text-foreground">Veto Trade</h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Are you sure you want to veto the trade between {initiatorTeam.name} and {recipientTeam.name}?
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-sm text-foreground-secondary">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input mt-1 w-full h-24 resize-none"
              placeholder="Explain why you're vetoing this trade..."
            />
          </div>

          <div className="bg-error-bg p-3 rounded-lg">
            <p className="text-sm text-error">
              This action cannot be undone. The trade will be cancelled and both teams will be notified.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost" disabled={isLoading}>
            Cancel
          </button>
          <button onClick={handleVeto} className="btn btn-danger" disabled={isLoading}>
            {isLoading ? 'Vetoing...' : 'Veto Trade'}
          </button>
        </div>
      </div>
    </div>
  )
}
