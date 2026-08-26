'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Image from 'next/image'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'
import type {
  TeamWithOwner,
  TradeActionResult,
  TradeOfferWithTeams,
  TradeItems,
  TradeMovieItem,
  TradeableMovie,
  TeamBudget,
} from '@/types'
import { formatRelativeDate } from '@/utils/date'
import AcceptConfirmModal from './AcceptConfirmModal'
import OfferExpiryPicker, { Chip } from './OfferExpiryPicker'
import { useOfferExpiry } from '../hooks/useOfferExpiry'
import {
  EXTEND_PRESETS,
  expiredReasonCopy,
  resolveExtension,
  expiryUrgency,
  formatExpiryAbsolute,
  type ExpiryUrgency,
  type ResolvedExpiry,
} from '@/utils/tradeExpiry'
import CounterpickMark from './CounterpickMark'

interface Props {
  trade: TradeOfferWithTeams
  currentTeamId: string
  currentTeam: TeamWithOwner
  isOwner: boolean
  otherTeams: TeamWithOwner[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  onRespond: (
    tradeOfferId: string,
    response: 'accept' | 'reject',
    message?: string
  ) => Promise<TradeActionResult>
  onCounter: (
    tradeOfferId: string,
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string,
    expiry?: ResolvedExpiry
  ) => Promise<TradeActionResult>
  onCancel: (tradeOfferId: string) => Promise<TradeActionResult>
  onVeto: (
    tradeOfferId: string,
    reason?: string
  ) => Promise<TradeActionResult>
  /**
   * Commissioner: end the review period now and process the trade immediately.
   * Without this the only commissioner action is veto -- an approved trade
   * otherwise waits out the full review window before the cron executes it.
   */
  onApprove: (tradeOfferId: string) => Promise<TradeActionResult>
  /**
   * Proposer: push their own offer's clock out, so the alternative to a slow
   * reply is not cancel-and-repropose.
   */
  onExtend: (tradeOfferId: string, expiresAt: string) => Promise<TradeActionResult>
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

/**
 * Statuses where an offer can still be won or lost. Contested only means
 * something while that is true -- a completed or expired trade has already had
 * its outcome decided, so flagging it would be noise.
 */
const OPEN_STATUSES = new Set(['proposed', 'countered', 'accepted', 'review'])

/**
 * Statuses where an offer's own clock still means anything. Once both parties
 * agree, the review window owns the trade and the offer expiry goes inert --
 * the row keeps it for audit, but showing it would be a second countdown
 * competing with the one that actually decides.
 */
const EXPIRY_RELEVANT_STATUSES = new Set(['proposed', 'countered'])

/** Countdown pill treatment by how much time is left. */
const URGENCY_STYLES: Record<ExpiryUrgency, string> = {
  relaxed: 'text-foreground-muted',
  soon: 'bg-warning-bg text-warning',
  urgent: 'bg-error-bg text-error',
  lapsed: 'bg-surface-hover text-foreground-muted',
}


/** Stable empty set so a non-contested card doesn't allocate one per render. */
const EMPTY_CONTESTED: ReadonlySet<string> = new Set<string>()

type TradeAction = 'accept' | 'reject' | 'cancel' | 'veto' | 'approve'

/** Status to show while an action is in flight, rolled back if it fails (FE#9). */
const OPTIMISTIC_STATUS: Record<TradeAction, string> = {
  accept: 'review',
  reject: 'rejected',
  cancel: 'cancelled',
  veto: 'vetoed',
  // Approving executes the trade in the same request, so it lands on
  // 'completed' rather than passing back through 'accepted'.
  approve: 'completed',
}

/**
 * Find display name for a team by ID from the available team info
 */
function findDisplayName(
  teamId: string,
  currentTeam: TeamWithOwner,
  otherTeams: TeamWithOwner[]
): string | null {
  if (teamId === currentTeam.id) return currentTeam.display_name
  return otherTeams.find((t) => t.id === teamId)?.display_name ?? null
}

export default function TradeOfferCard(props: Props) {
  const {
    trade,
    currentTeamId,
    currentTeam,
    isOwner,
    otherTeams,
    tradeableMovies,
    budget,
    onRespond,
    onCounter,
    onCancel,
    onVeto,
    onApprove,
    onExtend,
  } = props

  // formatRelativeDate is a pure formatter, so a countdown only moves when
  // something re-renders. Tick it -- but only inside the last hour of an open
  // offer, so a page of cards is not re-rendering on a timer for a deadline
  // that is days away.
  const [tickNow, setTickNow] = useState(() => Date.now())

  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCounterModal, setShowCounterModal] = useState(false)
  const [showVetoModal, setShowVetoModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showAcceptModal, setShowAcceptModal] = useState(false)
  const [showExtendModal, setShowExtendModal] = useState(false)

  // Optimistic UI state (FE#9)
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null)

  const isInitiator = trade.initiator_team_id === currentTeamId
  const isRecipient = trade.recipient_team_id === currentTeamId
  const canRespond = isRecipient && (trade.status === 'proposed' || trade.status === 'countered')
  const canCancel = isInitiator && (trade.status === 'proposed' || trade.status === 'countered')
  // Only the side whose offer is on the table, and only when there is a clock
  // to move. An offer already past its clock but not yet swept still shows the
  // button and is refused by the server -- the same submit-then-explain the
  // rest of the trade actions use, rather than a second copy of the rule here.
  const canExtend =
    isInitiator && Boolean(trade.expires_at) && EXPIRY_RELEVANT_STATUSES.has(trade.status)
  const canVeto = isOwner && trade.status === 'review'
  // Deliberately the same window as veto: approving is the other answer to the
  // review the commissioner is already being asked for.
  const canApprove = isOwner && trade.status === 'review'

  // Use optimistic status if available, otherwise actual status
  const displayStatus = optimisticStatus || trade.status
  const statusStyle = STATUS_STYLES[displayStatus] || STATUS_STYLES.proposed

  // Movies in this offer that another open offer also wants. Several offers may
  // compete for the same movie, and only the first to go through happens.
  const contestedSourceIds = new Set(trade.contested_source_ids ?? [])
  const isContested = contestedSourceIds.size > 0 && OPEN_STATUSES.has(displayStatus)

  const showExpiry = Boolean(trade.expires_at) && EXPIRY_RELEVANT_STATUSES.has(displayStatus)
  const urgency = trade.expires_at ? expiryUrgency(trade.expires_at, tickNow) : 'relaxed'
  const expiredReason =
    trade.status === 'expired'
      ? // The title comes from get-trades, which resolved it from the live
        // movies table -- deriving it here from the items snapshot could name
        // the wrong film once release dates moved.
        expiredReasonCopy(trade.expired_reason, trade.anchor_movie_title)
      : null

  const expiresAt = trade.expires_at
  useEffect(() => {
    if (!expiresAt || !EXPIRY_RELEVANT_STATUSES.has(displayStatus)) return

    if (new Date(expiresAt).getTime() - Date.now() > 60 * 60 * 1000) return

    // Half-minute cadence: formatRelativeDate resolves to whole minutes, so
    // anything finer would re-render without changing a pixel. The interval
    // stops itself at zero -- the row's status does not change until the cron
    // sweeps it, so waiting on displayStatus would leave this ticking against
    // a dead offer for as long as the page stayed open.
    const timer = setInterval(() => {
      setTickNow(Date.now())
      if (new Date(expiresAt).getTime() <= Date.now()) clearInterval(timer)
    }, 30_000)
    return () => clearInterval(timer)
  }, [expiresAt, displayStatus])

  const tradeAction = useCallback(
    async (action: TradeAction, message?: string) => {
      setPendingAction(action)
      setError(null)
      setOptimisticStatus(OPTIMISTIC_STATUS[action])

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
        case 'approve':
          result = await onApprove(trade.id)
          break
        default:
          result = { success: false, error: 'Unknown action' }
      }

      setPendingAction(null)

      if (!result.success) {
        // Roll back optimistic update on error
        setOptimisticStatus(null)
        if (result.error) {
          setError(result.error)
        }
      } else if (action === 'accept') {
        trackEvent('trade_accepted', { league_id: trade.league_id })
      } else if (action === 'reject') {
        trackEvent('trade_rejected', { league_id: trade.league_id })
      }
      // If successful, the real-time subscription will update the trade
    },
    [trade.id, trade.league_id, onRespond, onCancel, onVeto, onApprove]
  )

  const { execute: handleAction, isLoading } = useAsyncAction(tradeAction)

  const initiatorTeam = trade.initiator_team as { id: string; name: string; avatar_url: string | null }
  const recipientTeam = trade.recipient_team as { id: string; name: string; avatar_url: string | null }

  // Get display names for both teams
  const initiatorDisplayName = findDisplayName(initiatorTeam.id, currentTeam, otherTeams)
  const recipientDisplayName = findDisplayName(recipientTeam.id, currentTeam, otherTeams)

  return (
    <article
      className="card p-4"
      aria-label={`Trade offer from ${initiatorTeam.name} to ${recipientTeam.name}`}
      data-testid={`trade-card-${trade.id}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2" aria-hidden="true">
            <TeamAvatar team={initiatorTeam} />
            <TeamAvatar team={recipientTeam} />
          </div>
          <div>
            <p className="font-medium text-foreground">
              {initiatorTeam.name} <span aria-label="to">→</span> {recipientTeam.name}
            </p>
            {initiatorDisplayName && recipientDisplayName && (
              <p className="text-xs text-foreground-muted">
                {initiatorDisplayName} <span aria-label="to">→</span> {recipientDisplayName}
              </p>
            )}
            <p className="text-sm text-foreground-muted">
              <time dateTime={trade.proposed_at}>{formatRelativeDate(trade.proposed_at)}</time>
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className={`px-2 py-1 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}
            role="status"
            aria-live="polite"
          >
            {optimisticStatus ? `${statusStyle.label}...` : statusStyle.label}
          </span>

          {showExpiry && trade.expires_at && (
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${
                URGENCY_STYLES[urgency]
              } ${
                // An offer about to lapse on YOUR desk is a "your turn" state,
                // which is what this animation is for. The proposer, who can do
                // nothing but wait, gets the colour without the motion.
                urgency === 'urgent' && isRecipient ? 'animate-glow-pulse' : ''
              }`}
              data-testid={`trade-expiry-${trade.id}`}
            >
              Expires{' '}
              <time dateTime={trade.expires_at} title={formatExpiryAbsolute(trade.expires_at)}>
                {formatRelativeDate(trade.expires_at)}
              </time>
            </span>
          )}

          {isContested && (
            <span
              className="px-2 py-0.5 text-xs font-medium rounded bg-warning-bg text-warning"
              data-testid={`trade-contested-${trade.id}`}
            >
              Contested
              <span className="sr-only">
                . Another open trade wants a movie in this deal. Only the first trade to go
                through will happen.
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Trade items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <TradeItemsSection
          title={`${initiatorTeam.name} sends`}
          items={trade.initiator_items as TradeItems}
          isYours={isInitiator}
          contestedSourceIds={isContested ? contestedSourceIds : EMPTY_CONTESTED}
        />
        <TradeItemsSection
          title={`${recipientTeam.name} sends`}
          items={trade.recipient_items as TradeItems}
          isYours={isRecipient}
          contestedSourceIds={isContested ? contestedSourceIds : EMPTY_CONTESTED}
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
          {isOwner && (
            <p className="text-xs text-warning/80 mt-1">
              It processes automatically then — approve to process it now, or veto to block it.
            </p>
          )}
        </div>
      )}

      {/*
        Why it expired. Before this, a lapsed offer and one killed by a competing
        trade both rendered as a bare "Expired"; expired_reason covers the first
        case and veto_reason still explains the rest.
      */}
      {trade.status === 'expired' && (expiredReason || trade.veto_reason) && (
        <div className="mb-4 p-3 bg-surface-hover rounded-lg">
          <p className="text-sm text-foreground-secondary">
            <span className="font-medium">Expired:</span> {expiredReason ?? trade.veto_reason}
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
      {(canRespond || canCancel || canExtend || canVeto || canApprove) && !optimisticStatus && (
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border" role="group" aria-label="Trade actions">
          {canRespond && (
            <>
              <button
                onClick={() => setShowAcceptModal(true)}
                disabled={isLoading}
                className="btn btn-primary"
                aria-label="Accept trade offer"
                aria-busy={pendingAction === 'accept'}
                data-testid={`accept-trade-${trade.id}`}
              >
                {pendingAction === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
              <button
                onClick={() => setShowCounterModal(true)}
                disabled={isLoading}
                className="btn btn-secondary"
                aria-label="Counter trade offer"
                data-testid={`counter-trade-${trade.id}`}
              >
                Counter
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={isLoading}
                className="btn btn-ghost"
                aria-label="Reject trade offer"
                aria-busy={pendingAction === 'reject'}
                data-testid={`reject-trade-${trade.id}`}
              >
                {pendingAction === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            </>
          )}

          {canExtend && (
            <button
              onClick={() => setShowExtendModal(true)}
              disabled={isLoading}
              className="btn btn-secondary"
              aria-label="Give the other team more time to answer"
              data-testid={`extend-trade-${trade.id}`}
            >
              Extend
            </button>
          )}

          {canCancel && (
            <button
              onClick={() => handleAction('cancel')}
              disabled={isLoading}
              className="btn btn-ghost text-crimson"
              aria-label="Cancel trade offer"
              aria-busy={pendingAction === 'cancel'}
              data-testid={`cancel-trade-${trade.id}`}
            >
              {pendingAction === 'cancel' ? 'Cancelling...' : 'Cancel Trade'}
            </button>
          )}

          {canApprove && (
            <button
              onClick={() => setShowApproveModal(true)}
              disabled={isLoading}
              className="btn btn-primary"
              aria-label="Approve trade and process it now"
              aria-busy={pendingAction === 'approve'}
              data-testid={`approve-trade-${trade.id}`}
            >
              {pendingAction === 'approve' ? 'Approving...' : 'Approve Now'}
            </button>
          )}

          {canVeto && (
            <button
              onClick={() => setShowVetoModal(true)}
              disabled={isLoading}
              className="btn btn-danger"
              aria-label="Veto trade"
              data-testid={`veto-trade-${trade.id}`}
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
          onCounter={async (counterOfferedItems, counterRequestedItems, message, expiry) => {
            const result = await onCounter(trade.id, counterOfferedItems, counterRequestedItems, message, expiry)
            if (result.success) {
              setShowCounterModal(false)
            } else if (result.error) {
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

      {/* Approve Modal (commissioner) */}
      {showApproveModal && (
        <ApproveModal
          trade={trade}
          onClose={() => setShowApproveModal(false)}
          onApprove={async () => {
            setShowApproveModal(false)
            await handleAction('approve')
          }}
        />
      )}

      {/* Extend Offer Modal (proposer) */}
      {showExtendModal && trade.expires_at && (
        <ExtendOfferModal
          trade={trade}
          expiresAt={trade.expires_at}
          onClose={() => setShowExtendModal(false)}
          onExtend={onExtend}
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
    </article>
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
  contestedSourceIds,
}: {
  title: string
  items: TradeItems
  isYours: boolean
  /** Empty unless this offer is still open and competing offers exist. */
  contestedSourceIds: ReadonlySet<string>
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
              <div className="relative shrink-0">
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
                {movie.source === 'counterpick' && <CounterpickMark />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {movie.title || 'Unknown Movie'}
                </p>
                {/* Without this the row is indistinguishable from the movie
                    itself -- same title, same poster, opposite meaning. */}
                {movie.source === 'counterpick' && (
                  <p className="text-xs text-crimson">Counterpick</p>
                )}
                {movie.release_date && (
                  <p className="text-xs text-foreground-muted">
                    {new Date(movie.release_date).getFullYear()}
                  </p>
                )}
                {/* The card badge says the deal is contested; this says which
                    movie, which is the part that matters on a multi-movie offer. */}
                {contestedSourceIds.has(movie.source_id) && (
                  <p className="text-xs text-warning">Also in another trade</p>
                )}
              </div>
            </div>
          ))}

          {items.faab > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gold/20 rounded flex items-center justify-center">
                <span className="text-gold font-bold text-sm">$</span>
              </div>
              <p className="text-sm font-medium text-gold">${items.faab} budget</p>
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
    message?: string,
    expiry?: ResolvedExpiry
  ) => Promise<TradeActionResult>
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
  const [offeredBudget, setOfferedBudget] = useState(existingRecipientItems.faab || 0)

  const [requestedMovies, setRequestedMovies] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    existingInitiatorItems.movies.forEach((m) => ids.add(m.source_id))
    return ids
  })
  const [requestedBudget, setRequestedBudget] = useState(existingInitiatorItems.faab || 0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Items the server rejected on the last counter attempt. */
  const [invalidSourceIds, setInvalidSourceIds] = useState<ReadonlySet<string>>(EMPTY_CONTESTED)

  // Get the other team's movies from the original trade items
  const otherTeamMovies: TradeableMovie[] = existingInitiatorItems.movies.map((m) => ({
    movie_id: m.movie_id,
    source: m.source,
    source_id: m.source_id,
    title: m.title || 'Unknown',
    poster_url: m.poster_url || null,
    release_date: m.release_date || null,
    combined_score: null,
    fantasy_points: null,
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
    offeredMovies.size > 0 || offeredBudget > 0 || requestedMovies.size > 0 || requestedBudget > 0

  const counterMovies = useMemo(
    () => [
      ...tradeableMovies.filter((m) => offeredMovies.has(m.source_id)),
      ...otherTeamMovies.filter((m) => requestedMovies.has(m.source_id)),
    ],
    [tradeableMovies, offeredMovies, otherTeamMovies, requestedMovies]
  )
  // A counter is a new offer wearing the old row, so it gets its own clock
  // rather than inheriting the one it is answering.
  const expiry = useOfferExpiry(counterMovies)

  const submitCounterAction = useCallback(async () => {
    setError(null)
    setInvalidSourceIds(EMPTY_CONTESTED)

    const counterOfferedItems: TradeItems = {
      movies: tradeableMovies
        .filter((m) => offeredMovies.has(m.source_id))
        .map((m) => ({
          movie_id: m.movie_id,
          source: m.source,
          source_id: m.source_id,
        })),
      faab: offeredBudget,
    }

    const counterRequestedItems: TradeItems = {
      movies: otherTeamMovies
        .filter((m) => requestedMovies.has(m.source_id))
        .map((m) => ({
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

    const result = await onCounter(
      counterOfferedItems,
      counterRequestedItems,
      message.trim() || undefined,
      resolved.expiry
    )

    if (!result.success) {
      setError(result.error || 'Failed to submit counter-offer')
      setInvalidSourceIds(new Set(result.invalidSourceIds ?? []))
    }
  }, [tradeableMovies, offeredMovies, offeredBudget, otherTeamMovies, requestedMovies, requestedBudget, message, expiry, onCounter])

  const { execute: handleSubmit, isLoading } = useAsyncAction(submitCounterAction)

  // Handle escape key to close modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="counter-trade-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 id="counter-trade-title" className="text-lg font-display font-bold text-foreground">
            Counter Trade with {initiatorTeam.name}
          </h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Close counter trade modal"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Your side - what you offer */}
          <div>
            <h3 id="counter-offer-section" className="text-sm font-medium text-foreground mb-3">You give ({recipientTeam.name})</h3>
            <MovieSelector
              movies={tradeableMovies}
              selectedIds={offeredMovies}
              onToggle={toggleOfferedMovie}
              invalidIds={invalidSourceIds}
            />
            <div className="mt-3">
              <label htmlFor="counter-offered-budget" className="text-sm text-foreground-secondary">Budget (max ${budget?.remaining_budget ?? 0})</label>
              <input
                id="counter-offered-budget"
                type="number"
                min={0}
                max={budget?.remaining_budget ?? 0}
                value={offeredBudget}
                onChange={(e) => setOfferedBudget(Math.max(0, parseInt(e.target.value) || 0))}
                className="input mt-1 w-24"
              />
            </div>
          </div>

          {/* Their side - what you request */}
          <div>
            <h3 id="counter-request-section" className="text-sm font-medium text-foreground mb-3">You receive ({initiatorTeam.name})</h3>
            <MovieSelector
              movies={otherTeamMovies}
              selectedIds={requestedMovies}
              onToggle={toggleRequestedMovie}
              invalidIds={invalidSourceIds}
            />
            <div className="mt-3">
              <label htmlFor="counter-requested-budget" className="text-sm text-foreground-secondary">Budget</label>
              <input
                id="counter-requested-budget"
                type="number"
                min={0}
                max={100}
                value={requestedBudget}
                onChange={(e) => setRequestedBudget(Math.max(0, parseInt(e.target.value) || 0))}
                className="input mt-1 w-24"
              />
            </div>
          </div>

          {/* Message */}
          <OfferExpiryPicker
            releaseAnchor={expiry.releaseAnchor}
            value={expiry.choice}
            onChange={expiry.setChoice}
            resolution={expiry.resolution}
            fellBack={expiry.fellBack}
          />

          <div>
            <label htmlFor="counter-message" className="text-sm text-foreground-secondary">Message (optional)</label>
            <textarea
              id="counter-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input mt-1 w-full h-20 resize-none"
              placeholder="Add a note to your counter-offer..."
            />
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            aria-label="Cancel counter offer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasItems || !expiry.resolution.ok || isLoading}
            className="btn btn-primary"
            aria-label={isLoading ? 'Submitting counter offer...' : 'Submit counter offer'}
            aria-busy={isLoading}
          >
            {isLoading ? 'Submitting...' : 'Submit Counter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Movie Selector (shared helper with accessibility)
// =============================================================================

function MovieSelector({
  movies,
  selectedIds,
  onToggle,
  invalidIds = EMPTY_CONTESTED,
}: {
  movies: TradeableMovie[]
  selectedIds: Set<string>
  onToggle: (sourceId: string) => void
  /** Items the server rejected on the last submit. */
  invalidIds?: ReadonlySet<string>
}) {
  // Empty state with helpful message (FE#7)
  if (movies.length === 0) {
    return (
      <div className="card p-4 text-center">
        <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-surface-hover flex items-center justify-center">
          <svg
            className="w-5 h-5 text-foreground-muted"
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
        <p className="text-sm text-foreground-muted">No movies available to trade</p>
      </div>
    )
  }

  return (
    <div
      role="listbox"
      aria-label="Select movies"
      aria-multiselectable="true"
      className="space-y-2 max-h-48 overflow-y-auto"
    >
      {movies.map((movie) => {
        const isSelected = selectedIds.has(movie.source_id)
        const isInvalid = invalidIds.has(movie.source_id)
        return (
          <div
            key={movie.source_id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onToggle(movie.source_id)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                onToggle(movie.source_id)
              }
            }}
            className={`w-full p-2 rounded-lg flex items-center gap-3 text-left transition-colors cursor-pointer ${
              isInvalid
                ? 'bg-crimson/15 border border-crimson'
                : isSelected
                  ? 'bg-gold/20 border border-gold'
                  : 'bg-surface-hover hover:bg-elevated border border-transparent'
            } focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-surface`}
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
                {isInvalid && <span className="font-medium text-crimson">Can&apos;t be traded</span>}
                {movie.source === 'counterpick' && (
                  <span className="text-crimson">
                    {movie.counterpick_target_team_name
                      ? `vs. ${movie.counterpick_target_team_name}`
                      : 'Counterpick'}
                  </span>
                )}
                {movie.release_date && <span>{new Date(movie.release_date).getFullYear()}</span>}
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
    </div>
  )
}

// =============================================================================
// Extend Offer Modal (proposer)
// =============================================================================

interface ExtendOfferModalProps {
  trade: TradeOfferWithTeams
  /** The clock being pushed out. Narrowed by the caller so it is never null. */
  expiresAt: string
  onClose: () => void
  /**
   * Takes the trade id so the card can pass its hook callback straight through.
   * Wrapping it in an arrow at the call site gave the prop a new identity every
   * render -- including on the countdown tick, which fires during exactly the
   * last hour when this modal is most likely to be open.
   */
  onExtend: (tradeOfferId: string, newExpiresAt: string) => Promise<TradeActionResult>
}

/**
 * Give the other side more time.
 *
 * Only ever offers later times, which is the forward-only rule made visible --
 * the server enforces it, along with the 14-day ceiling and the league trade
 * deadline, so an over-long extension comes back as a refusal here rather than
 * being pre-emptively greyed out.
 */
function ExtendOfferModal({ trade, expiresAt, onClose, onExtend }: ExtendOfferModalProps) {
  const [hours, setHours] = useState(EXTEND_PRESETS[0].hours)
  const [error, setError] = useState<string | null>(null)

  const recipientTeam = trade.recipient_team as { name: string }
  // One expression, used for both the preview and the request: computing the
  // target twice let the instant shown and the instant sent drift apart.
  const newExpiresAt = resolveExtension(expiresAt, hours)

  const extendAction = useCallback(async () => {
    setError(null)
    const result = await onExtend(trade.id, newExpiresAt.toISOString())

    if (!result.success) {
      setError(result.error || 'Failed to extend the offer')
      return
    }

    trackEvent('trade_offer_extended', { league_id: trade.league_id })
    onClose()
  }, [newExpiresAt, onExtend, onClose, trade.id, trade.league_id])

  const { execute: handleExtend, isLoading } = useAsyncAction(extendAction)

  // On document rather than the dialog: a keydown handler on the panel only
  // fires once focus is already inside it, so Escape does nothing until the user
  // tabs in. Same approach as AcceptConfirmModal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isLoading])

  return (
    // .modal-overlay / .modal-panel rather than a hand-rolled backdrop: the
    // tokens carry the app's dimming and blur, and a lighter unanimated copy
    // reads as a different kind of dialog. The two sibling modals in this file
    // predate those classes; this one should not become a third divergence.
    <div
      className="modal-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-offer-title"
    >
      <div className="modal-panel bg-surface rounded-lg shadow-heavy max-w-md w-full border border-border">
        <div className="p-4 border-b border-border">
          <h2 id="extend-offer-title" className="text-lg font-display font-bold text-foreground">
            Extend Offer
          </h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Give {recipientTeam.name} more time to answer. An offer can only be extended, never
            shortened.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-foreground-muted">
            Currently expires{' '}
            <time dateTime={expiresAt} className="text-foreground-secondary">
              {formatExpiryAbsolute(expiresAt)}
            </time>
          </p>

          <div>
            <span className="text-sm text-foreground-secondary">Extend by</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {EXTEND_PRESETS.map((preset) => (
                <Chip
                  key={preset.hours}
                  selected={hours === preset.hours}
                  onClick={() => setHours(preset.hours)}
                >
                  {preset.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* A chip alone never says when. Same rule as the proposal picker. */}
          <p className="text-sm text-foreground-muted">
            New expiry:{' '}
            <time dateTime={newExpiresAt.toISOString()} className="text-foreground-secondary">
              {formatExpiryAbsolute(newExpiresAt.toISOString())}
            </time>
          </p>

          {/*
            The one thing an extension changes besides the time. Saying it here,
            before the click, is the whole reason this is a modal rather than a
            bare "+24h" button: the offer stops following the movie, and finding
            that out afterwards would read as the app rewriting the deal.
          */}
          {trade.expiry_anchor === 'movie_release' && (
            <div className="alert alert-warning" role="alert">
              <p className="text-sm">
                This offer runs until {trade.anchor_movie_title ?? 'its movie'} releases. Extending
                it past that replaces the release anchor with a fixed time, so it will stop
                following the movie&apos;s schedule.
              </p>
            </div>
          )}

          {error && (
            <div className="alert alert-error" role="alert">
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel extending the offer"
          >
            Cancel
          </button>
          <button
            onClick={() => handleExtend()}
            className="btn btn-primary"
            disabled={isLoading}
            aria-label="Confirm extending the offer"
            aria-busy={isLoading}
            data-testid={`confirm-extend-trade-${trade.id}`}
          >
            {isLoading ? 'Extending...' : 'Extend Offer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Approve Modal (commissioner)
// =============================================================================

interface ApproveModalProps {
  trade: TradeOfferWithTeams
  onClose: () => void
  onApprove: () => Promise<void>
}

/**
 * Confirmation for ending a review period early. Worth a confirm step: unlike
 * veto -- which only stops something -- this moves movies and budget the moment
 * it is clicked, before the deadline both teams were told to expect.
 */
function ApproveModal({ trade, onClose, onApprove }: ApproveModalProps) {
  const initiatorTeam = trade.initiator_team as { name: string }
  const recipientTeam = trade.recipient_team as { name: string }

  const { execute: handleApprove, isLoading } = useAsyncAction(onApprove)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h2 id="approve-modal-title" className="text-lg font-display font-bold text-foreground">
            Approve Trade
          </h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Process the trade between {initiatorTeam.name} and {recipientTeam.name} now, without
            waiting for the review period to end?
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div className="p-3 rounded-lg bg-surface-hover">
            <p className="text-sm text-foreground-secondary">
              Movies and budget change hands immediately, and both teams are notified that you
              approved the trade.
            </p>
          </div>

          {trade.contested_source_ids && trade.contested_source_ids.length > 0 && (
            <div className="alert alert-warning" role="alert">
              <p className="text-sm">
                A movie in this trade is also in another open offer. Approving settles it here and
                expires the competing offer.
              </p>
            </div>
          )}

          <div className="bg-warning-bg p-3 rounded-lg" role="alert">
            <p className="text-sm text-warning">
              This action cannot be undone — the trade can no longer be vetoed once processed.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel approval"
          >
            Cancel
          </button>
          <button
            onClick={() => handleApprove()}
            className="btn btn-primary"
            disabled={isLoading}
            aria-label="Confirm approve trade"
            aria-busy={isLoading}
            data-testid={`confirm-approve-trade-${trade.id}`}
          >
            {isLoading ? 'Approving...' : 'Approve & Process'}
          </button>
        </div>
      </div>
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

  const initiatorTeam = trade.initiator_team as { name: string }
  const recipientTeam = trade.recipient_team as { name: string }

  const vetoAction = useCallback(
    async (reasonText: string) => {
      await onVeto(reasonText || undefined)
    },
    [onVeto]
  )

  const { execute, isLoading } = useAsyncAction(vetoAction)

  function handleVeto(): void {
    execute(reason.trim())
  }

  // Handle escape key to close modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="veto-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h2 id="veto-modal-title" className="text-lg font-display font-bold text-foreground">Veto Trade</h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Are you sure you want to veto the trade between {initiatorTeam.name} and {recipientTeam.name}?
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label htmlFor="veto-reason" className="text-sm text-foreground-secondary">Reason (optional)</label>
            <textarea
              id="veto-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input mt-1 w-full h-24 resize-none"
              placeholder="Explain why you're vetoing this trade..."
            />
          </div>

          <div className="bg-error-bg p-3 rounded-lg" role="alert">
            <p className="text-sm text-error">
              This action cannot be undone. The trade will be cancelled and both teams will be notified.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel veto"
          >
            Cancel
          </button>
          <button
            onClick={handleVeto}
            className="btn btn-danger"
            disabled={isLoading}
            aria-label="Confirm veto trade"
            aria-busy={isLoading}
          >
            {isLoading ? 'Vetoing...' : 'Veto Trade'}
          </button>
        </div>
      </div>
    </div>
  )
}
