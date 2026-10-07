'use client'

import { useState, useCallback, useEffect, useId, useMemo } from 'react'
import Image from 'next/image'
import { safeAvatarUrl } from '@/utils/avatar'
import Modal from '@/app/components/Modal'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'
import type {
  TeamWithOwner,
  TradeActionResult,
  TradeOfferWithTeams,
  TradeItems,
  TradeableMovie,
  TeamBudget,
} from '@/types'
import { formatRelativeDate } from '@/utils/date'
import AcceptConfirmModal from './AcceptConfirmModal'
import OfferExpiryPicker, { Chip } from './OfferExpiryPicker'
import { useOfferExpiry } from '../hooks/useOfferExpiry'
import {
  expiredReasonCopy,
  extendPresetsFor,
  resolveExtension,
  expiryUrgency,
  formatExpiryAbsolute,
  type ExpiryBounds,
  type ExpiryUrgency,
  type ResolvedExpiry,
} from '@/utils/tradeExpiry'
import TradeItemsSection from './TradeItemsSection'
import { DialogCloseButton, TradeBudgetField, TradeMovieChecklist } from './TradeComposerFields'
import TradeComposerLoading, { type TradeComposerState } from './TradeComposerLoading'

interface Props {
  trade: TradeOfferWithTeams
  currentTeamId: string
  currentTeam: TeamWithOwner
  isOwner: boolean
  otherTeams: TeamWithOwner[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  composerState: TradeComposerState
  /** The league's offer-window rules, for the counter and extend modals. */
  expiryBounds: ExpiryBounds
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
  /**
   * An action on this card succeeded. The panel announces `message` and, when
   * the action took the focused control away, puts focus back somewhere real.
   */
  onActionSettled: (tradeId: string, message: string) => void
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

/** Dims an action while another is in flight, without `disabled` dropping focus. */
const BUSY_CLASS = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

/** @design-system League */
export default function TradeOfferCard(props: Props) {
  const {
    trade,
    currentTeamId,
    currentTeam,
    isOwner,
    otherTeams,
    tradeableMovies,
    budget,
    composerState,
    expiryBounds,
    onRespond,
    onCounter,
    onCancel,
    onVeto,
    onApprove,
    onExtend,
    onActionSettled,
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
  // Once the real status arrives the guess has served its purpose. Without
  // this a card that stays on screen (a commissioner who accepted their own
  // trade, say) would keep its actions marked busy indefinitely.
  const [statusSeen, setStatusSeen] = useState(trade.status)
  if (trade.status !== statusSeen) {
    setStatusSeen(trade.status)
    setOptimisticStatus(null)
  }

  const headingId = useId()

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

  const initiatorTeam = trade.initiator_team as { id: string; name: string; avatar_url: string | null }
  const recipientTeam = trade.recipient_team as { id: string; name: string; avatar_url: string | null }
  const initiatorName = initiatorTeam.name
  const recipientName = recipientTeam.name

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
        return
      }

      if (action === 'accept') {
        trackEvent('trade_accepted', { league_id: trade.league_id })
      } else if (action === 'reject') {
        trackEvent('trade_rejected', { league_id: trade.league_id })
      }
      // The real-time subscription updates the card itself; this says so out loud.
      const settled: Record<TradeAction, string> = {
        accept: `You accepted the trade with ${initiatorName}.`,
        reject: `You rejected the trade offer from ${initiatorName}.`,
        cancel: `You cancelled your trade offer to ${recipientName}.`,
        veto: `You vetoed the trade between ${initiatorName} and ${recipientName}.`,
        approve: `You approved the trade between ${initiatorName} and ${recipientName}. It has been processed.`,
      }
      onActionSettled(trade.id, settled[action])
    },
    [trade.id, trade.league_id, initiatorName, recipientName, onRespond, onCancel, onVeto, onApprove, onActionSettled]
  )

  const { execute: handleAction, isLoading } = useAsyncAction(tradeAction)

  const handleExtended = useCallback(
    (newExpiresAt: string) => {
      setShowExtendModal(false)
      onActionSettled(trade.id, `Offer extended. It now expires ${formatExpiryAbsolute(newExpiresAt)}.`)
    },
    [trade.id, onActionSettled]
  )

  // While an action is in flight the buttons stay mounted and focusable (so
  // focus is not dropped) but do nothing; useAsyncAction guards the requests,
  // this guards the buttons that only open a dialog.
  const isBusy = isLoading || optimisticStatus !== null
  const unlessBusy = (open: () => void) => () => {
    if (!isBusy) open()
  }

  // Get display names for both teams
  const initiatorDisplayName = findDisplayName(initiatorTeam.id, currentTeam, otherTeams)
  const recipientDisplayName = findDisplayName(recipientTeam.id, currentTeam, otherTeams)

  return (
    <article
      className="card p-4"
      aria-label={`Trade offer from ${initiatorName} to ${recipientName}`}
      tabIndex={-1}
      data-trade-id={trade.id}
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
            <h3 id={headingId} className="font-medium text-foreground">
              {initiatorName} <ArrowTo /> {recipientName}
            </h3>
            {initiatorDisplayName && recipientDisplayName && (
              <p className="type-meta text-foreground-secondary">
                {initiatorDisplayName} <ArrowTo /> {recipientDisplayName}
              </p>
            )}
            <p className="type-body-sm text-foreground-secondary">
              <time dateTime={trade.proposed_at}>{formatRelativeDate(trade.proposed_at)}</time>
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Not a live region: outcomes are announced once, by the panel. */}
          <span className={`type-meta px-2 py-1 rounded ${statusStyle.bg} ${statusStyle.text}`}>
            {optimisticStatus ? `${statusStyle.label}...` : statusStyle.label}
          </span>

          {showExpiry && trade.expires_at && (
            <span
              className={`type-meta px-2 py-0.5 rounded ${
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
              <span className="sr-only"> ({formatExpiryAbsolute(trade.expires_at)})</span>
            </span>
          )}

          {isContested && (
            <span
              className="type-meta px-2 py-0.5 rounded bg-warning-bg text-warning"
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
          title={`${initiatorName} sends`}
          items={trade.initiator_items as TradeItems}
          isYours={isInitiator}
          contestedSourceIds={isContested ? contestedSourceIds : EMPTY_CONTESTED}
        />
        <TradeItemsSection
          title={`${recipientName} sends`}
          items={trade.recipient_items as TradeItems}
          isYours={isRecipient}
          contestedSourceIds={isContested ? contestedSourceIds : EMPTY_CONTESTED}
        />
      </div>

      {/* Messages */}
      {trade.initiator_message && (
        <div className="mb-4 p-3 bg-surface-hover rounded-lg">
          <p className="type-body-sm text-foreground-secondary">
            <span className="font-medium">{initiatorName}:</span> {trade.initiator_message}
          </p>
        </div>
      )}

      {trade.response_message && (
        <div className="mb-4 p-3 bg-surface-hover rounded-lg">
          <p className="type-body-sm text-foreground-secondary">
            <span className="font-medium">{recipientName}:</span> {trade.response_message}
          </p>
        </div>
      )}

      {/* Review countdown */}
      {trade.status === 'review' && trade.review_ends_at && (
        <div className="mb-4 p-3 bg-warning-bg rounded-lg">
          <p className="type-body-sm text-warning">
            Review period ends {formatRelativeDate(trade.review_ends_at)}
          </p>
          {isOwner && (
            <p className="type-meta text-warning/80 mt-1">
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
          <p className="type-body-sm text-foreground-secondary">
            <span className="font-medium">Expired:</span> {expiredReason ?? trade.veto_reason}
          </p>
        </div>
      )}

      {/* Veto reason */}
      {trade.status === 'vetoed' && trade.veto_reason && (
        <div className="mb-4 p-3 bg-error-bg rounded-lg">
          <p className="type-body-sm text-error">
            <span className="font-medium">Veto reason:</span> {trade.veto_reason}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* Actions -- kept mounted while one is in flight, so focus stays put. */}
      {(canRespond || canCancel || canExtend || canVeto || canApprove) && (
        <div className="flex flex-wrap gap-2 pt-4 border-t border-border" role="group" aria-label="Trade actions">
          {canRespond && (
            <>
              <button
                type="button"
                onClick={unlessBusy(() => setShowAcceptModal(true))}
                aria-disabled={isBusy || undefined}
                className={`btn btn-primary ${BUSY_CLASS}`}
                aria-describedby={headingId}
                aria-busy={pendingAction === 'accept'}
                data-testid={`accept-trade-${trade.id}`}
              >
                {pendingAction === 'accept' ? 'Accepting...' : 'Accept'}
              </button>
              <button
                type="button"
                onClick={unlessBusy(() => {
                  composerState.onOpen()
                  setShowCounterModal(true)
                })}
                aria-disabled={isBusy || undefined}
                className={`btn btn-secondary ${BUSY_CLASS}`}
                aria-describedby={headingId}
                data-testid={`counter-trade-${trade.id}`}
              >
                Counter
              </button>
              <button
                type="button"
                onClick={() => handleAction('reject')}
                aria-disabled={isBusy || undefined}
                className={`btn btn-ghost ${BUSY_CLASS}`}
                aria-describedby={headingId}
                aria-busy={pendingAction === 'reject'}
                data-testid={`reject-trade-${trade.id}`}
              >
                {pendingAction === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            </>
          )}

          {canExtend && (
            <button
              type="button"
              onClick={unlessBusy(() => setShowExtendModal(true))}
              aria-disabled={isBusy || undefined}
              className={`btn btn-secondary ${BUSY_CLASS}`}
              aria-describedby={headingId}
              data-testid={`extend-trade-${trade.id}`}
            >
              Extend
            </button>
          )}

          {canCancel && (
            <button
              type="button"
              onClick={() => handleAction('cancel')}
              aria-disabled={isBusy || undefined}
              className={`btn btn-ghost text-crimson-text ${BUSY_CLASS}`}
              aria-describedby={headingId}
              aria-busy={pendingAction === 'cancel'}
              data-testid={`cancel-trade-${trade.id}`}
            >
              {pendingAction === 'cancel' ? 'Cancelling...' : 'Cancel Trade'}
            </button>
          )}

          {canApprove && (
            <button
              type="button"
              onClick={unlessBusy(() => setShowApproveModal(true))}
              aria-disabled={isBusy || undefined}
              className={`btn btn-primary ${BUSY_CLASS}`}
              aria-describedby={headingId}
              aria-busy={pendingAction === 'approve'}
              data-testid={`approve-trade-${trade.id}`}
            >
              {pendingAction === 'approve' ? 'Approving...' : 'Approve Now'}
            </button>
          )}

          {canVeto && (
            <button
              type="button"
              onClick={unlessBusy(() => setShowVetoModal(true))}
              aria-disabled={isBusy || undefined}
              className={`btn btn-danger ${BUSY_CLASS}`}
              aria-describedby={headingId}
              aria-busy={pendingAction === 'veto'}
              data-testid={`veto-trade-${trade.id}`}
            >
              {pendingAction === 'veto' ? 'Vetoing...' : 'Veto trade'}
            </button>
          )}
        </div>
      )}

      {/* Counter Trade Modal */}
      {showCounterModal && (composerState.isLoading || composerState.error ? (
        <TradeComposerLoading state={composerState} onClose={() => setShowCounterModal(false)} />
      ) : (
        <CounterTradeModal
          trade={trade}
          currentTeamId={currentTeamId}
          tradeableMovies={tradeableMovies}
          budget={budget}
          expiryBounds={expiryBounds}
          onClose={() => setShowCounterModal(false)}
          onCounter={async (counterOfferedItems, counterRequestedItems, message, expiry) => {
            const result = await onCounter(trade.id, counterOfferedItems, counterRequestedItems, message, expiry)
            if (result.success) {
              setShowCounterModal(false)
              onActionSettled(trade.id, `Counter-offer sent to ${initiatorName}.`)
            } else if (result.error) {
              setError(result.error)
            }
            return result
          }}
        />
      ))}

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
          expiryBounds={expiryBounds}
          onClose={() => setShowExtendModal(false)}
          onExtend={onExtend}
          onExtended={handleExtended}
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

/** "→" reads as "right arrow"; say "to" instead. */
function ArrowTo() {
  return (
    <>
      <span aria-hidden="true">→</span>
      <span className="sr-only">to</span>
    </>
  )
}

function TeamAvatar({ team }: { team: { name: string; avatar_url: string | null } }) {
  const avatarUrl = safeAvatarUrl(team.avatar_url)
  return (
    <div className="w-8 h-8 rounded-full bg-surface-hover border-2 border-background flex items-center justify-center overflow-hidden">
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={team.name}
          width={32}
          height={32}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="type-meta text-foreground-secondary">
          {team.name.charAt(0).toUpperCase()}
        </span>
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
  expiryBounds: ExpiryBounds
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
    expiryBounds,
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
  const [offeredBudgetInput, setOfferedBudget] = useState(existingRecipientItems.faab || 0)
  const offeredBudget = budget ? offeredBudgetInput : 0

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

  const titleId = useId()
  const giveHeadingId = useId()
  const receiveHeadingId = useId()
  const messageId = useId()

  // Get the other team's movies from the original trade items. Memoized so the
  // expiry preview below only re-resolves when the selection changes.
  const otherTeamMovies = useMemo<TradeableMovie[]>(
    () =>
      existingInitiatorItems.movies.map((m) => ({
        movie_id: m.movie_id,
        source: m.source,
        source_id: m.source_id,
        title: m.title || 'Unknown',
        poster_url: m.poster_url || null,
        release_date: m.release_date || null,
        combined_score: null,
        fantasy_points: null,
      })),
    [existingInitiatorItems.movies]
  )

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
  const expiry = useOfferExpiry(counterMovies, expiryBounds)

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

  return (
    <Modal onClose={onClose} preventClose={isLoading} labelledBy={titleId} closeOnBackdrop>
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 id={titleId} tabIndex={-1} data-dialog-initial-focus className="type-panel text-foreground">
            Counter trade with {initiatorTeam.name}
          </h2>
          <DialogCloseButton label="Close counter offer" onClick={onClose} />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Your side - what you offer */}
          <div>
            <h3 id={giveHeadingId} className="type-label text-foreground mb-3">You give ({recipientTeam.name})</h3>
            <TradeMovieChecklist
              movies={tradeableMovies}
              selectedIds={offeredMovies}
              onToggle={toggleOfferedMovie}
              labelledBy={giveHeadingId}
              invalidIds={invalidSourceIds}
              showScores={false}
              emptyState={<NoMoviesToTrade />}
            />
            <TradeBudgetField
              side="you give"
              available={budget ? budget.remaining_budget : null}
              value={offeredBudget}
              onChange={setOfferedBudget}
            />
          </div>

          {/* Their side - what you request */}
          <div>
            <h3 id={receiveHeadingId} className="type-label text-foreground mb-3">You receive ({initiatorTeam.name})</h3>
            <TradeMovieChecklist
              movies={otherTeamMovies}
              selectedIds={requestedMovies}
              onToggle={toggleRequestedMovie}
              labelledBy={receiveHeadingId}
              invalidIds={invalidSourceIds}
              showScores={false}
              emptyState={<NoMoviesToTrade />}
            />
            <TradeBudgetField
              side={`you request from ${initiatorTeam.name}`}
              available={undefined}
              fallbackMax={100}
              value={requestedBudget}
              onChange={setRequestedBudget}
            />
          </div>

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
            <label htmlFor={messageId} className="type-label text-foreground-secondary">Message (optional)</label>
            <textarea
              id={messageId}
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
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            aria-label="Cancel counter offer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasItems || !expiry.resolution.ok || isLoading}
            className="btn btn-primary"
            aria-label={isLoading ? 'Submitting counter offer...' : 'Submit counter offer'}
            aria-busy={isLoading}
          >
            {isLoading ? 'Submitting...' : 'Submit counter'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function NoMoviesToTrade() {
  return (
    <div className="card p-4 text-center">
      <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-surface-hover flex items-center justify-center">
        <svg
          className="w-5 h-5 text-foreground-muted"
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
      <p className="type-body-sm text-foreground-secondary">No movies available to trade</p>
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
  /** The league's window rules -- which extensions are worth offering. */
  expiryBounds: ExpiryBounds
  onClose: () => void
  /**
   * Takes the trade id so the card can pass its hook callback straight through.
   * Wrapping it in an arrow at the call site gave the prop a new identity every
   * render -- including on the countdown tick, which fires during exactly the
   * last hour when this modal is most likely to be open.
   */
  onExtend: (tradeOfferId: string, newExpiresAt: string) => Promise<TradeActionResult>
  /** The extension went through; closes the modal and says when it now expires. */
  onExtended: (newExpiresAt: string) => void
}

/**
 * Give the other side more time.
 *
 * Only ever offers later times, which is the forward-only rule made visible.
 * The league's ceiling is applied the same way -- an extension that would land
 * past it is not offered at all, since the proposer cannot do anything about a
 * limit the commissioner set. The server still enforces both, along with the
 * trade deadline clamp, so anything that slips through comes back as a refusal
 * shown below.
 */
function ExtendOfferModal({
  trade,
  expiresAt,
  expiryBounds,
  onClose,
  onExtend,
  onExtended,
}: ExtendOfferModalProps) {
  // Fixed for as long as the modal is open. Recomputing on the card's countdown
  // tick would drop options out from under the pointer as the ceiling closes in.
  const presets = useMemo(
    () => extendPresetsFor(expiresAt, expiryBounds),
    [expiresAt, expiryBounds]
  )
  // An offer already running to the league's maximum has nothing left to give.
  const atCeiling = presets.length === 0

  const [hours, setHours] = useState(() => presets[0]?.hours ?? 0)
  const [error, setError] = useState<string | null>(null)

  const titleId = useId()
  const introId = useId()
  const anchorWarningId = useId()
  const presetName = useId()

  const recipientTeam = trade.recipient_team as { name: string }
  // One expression, used for both the preview and the request: computing the
  // target twice let the instant shown and the instant sent drift apart.
  const newExpiresAt = resolveExtension(expiresAt, hours)

  const extendAction = useCallback(async () => {
    setError(null)
    const iso = newExpiresAt.toISOString()
    const result = await onExtend(trade.id, iso)

    if (!result.success) {
      setError(result.error || 'Failed to extend the offer')
      return
    }

    trackEvent('trade_offer_extended', { league_id: trade.league_id })
    onExtended(iso)
  }, [newExpiresAt, onExtend, onExtended, trade.id, trade.league_id])

  const { execute: handleExtend, isLoading } = useAsyncAction(extendAction)

  const showAnchorWarning = !atCeiling && trade.expiry_anchor === 'movie_release'

  return (
    <Modal
      onClose={onClose}
      preventClose={isLoading}
      labelledBy={titleId}
      describedBy={showAnchorWarning ? `${introId} ${anchorWarningId}` : introId}
    >
      <div className="modal-panel bg-surface rounded-lg shadow-heavy max-w-md w-full border border-border">
        <div className="p-4 border-b border-border">
          <h2 id={titleId} className="type-panel text-foreground">
            Extend offer
          </h2>
          <p id={introId} className="type-body-sm text-foreground-secondary mt-1">
            Give {recipientTeam.name} more time to answer. An offer can only be extended, never
            shortened.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <p className="type-body-sm text-foreground-secondary">
            Currently expires{' '}
            <time dateTime={expiresAt} className="text-foreground-secondary">
              {formatExpiryAbsolute(expiresAt)}
            </time>
          </p>

          {atCeiling ? (
            <div className="alert alert-info" role="status">
              <p className="type-body-sm">
                This offer already runs as long as the league allows — no more than{' '}
                {expiryBounds.maxDays} {expiryBounds.maxDays === 1 ? 'day' : 'days'} from now.
              </p>
            </div>
          ) : (
            <>
              <fieldset>
                <legend className="type-body-sm text-foreground-secondary">Extend by</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <Chip
                      key={preset.hours}
                      name={presetName}
                      checked={hours === preset.hours}
                      // Locked while the request is in flight, like the confirm
                      // button. useAsyncAction's ref guard already blocks a
                      // second submit, but changing the selection mid-request
                      // leaves the preview describing a time that was not sent.
                      disabled={isLoading}
                      onSelect={() => setHours(preset.hours)}
                    >
                      {preset.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>

              {/* A chip alone never says when. Same rule as the proposal picker.
                  Polite live text, so arrowing through the chips says it too. */}
              <p className="type-body-sm text-foreground-secondary" aria-live="polite">
                New expiry:{' '}
                <time dateTime={newExpiresAt.toISOString()} className="text-foreground-secondary">
                  {formatExpiryAbsolute(newExpiresAt.toISOString())}
                </time>
              </p>
            </>
          )}

          {/*
            The one thing an extension changes besides the time. Saying it here,
            before the click, is the whole reason this is a modal rather than a
            bare "+24h" button: the offer stops following the movie, and finding
            that out afterwards would read as the app rewriting the deal.
          */}
          {showAnchorWarning && (
            <div id={anchorWarningId} className="alert alert-warning">
              <p className="type-body-sm">
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
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel extending the offer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleExtend()}
            className="btn btn-primary"
            disabled={isLoading || atCeiling}
            aria-busy={isLoading}
            data-testid={`confirm-extend-trade-${trade.id}`}
          >
            {isLoading ? 'Extending...' : 'Extend offer'}
          </button>
        </div>
      </div>
    </Modal>
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

  const titleId = useId()
  const questionId = useId()
  const effectId = useId()
  const contestedId = useId()
  const warningId = useId()
  const isContested = Boolean(trade.contested_source_ids && trade.contested_source_ids.length > 0)

  return (
    <Modal
      onClose={onClose}
      preventClose={isLoading}
      labelledBy={titleId}
      describedBy={[questionId, effectId, isContested ? contestedId : null, warningId].filter(Boolean).join(' ')}
    >
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h2 id={titleId} className="type-panel text-foreground">
            Approve trade
          </h2>
          <p id={questionId} className="type-body-sm text-foreground-secondary mt-1">
            Process the trade between {initiatorTeam.name} and {recipientTeam.name} now, without
            waiting for the review period to end?
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div className="p-3 rounded-lg bg-surface-hover">
            <p id={effectId} className="type-body-sm text-foreground-secondary">
              Movies and budget change hands immediately, and both teams are notified that you
              approved the trade.
            </p>
          </div>

          {isContested && (
            <div id={contestedId} className="alert alert-warning">
              <p className="type-body-sm">
                A movie in this trade is also in another open offer. Approving settles it here and
                expires the competing offer.
              </p>
            </div>
          )}

          <div id={warningId} className="bg-warning-bg p-3 rounded-lg">
            <p className="type-body-sm text-warning">
              This action cannot be undone — the trade can no longer be vetoed once processed.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel approval"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleApprove()}
            className="btn btn-primary"
            disabled={isLoading}
            aria-busy={isLoading}
            data-testid={`confirm-approve-trade-${trade.id}`}
          >
            {isLoading ? 'Approving...' : 'Approve & Process'}
          </button>
        </div>
      </div>
    </Modal>
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

  const titleId = useId()
  const questionId = useId()
  const warningId = useId()
  const reasonId = useId()

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

  return (
    <Modal
      onClose={onClose}
      preventClose={isLoading}
      labelledBy={titleId}
      describedBy={`${questionId} ${warningId}`}
    >
      <div className="relative bg-surface rounded-lg shadow-heavy max-w-md w-full">
        <div className="p-4 border-b border-border">
          <h2 id={titleId} className="type-panel text-foreground">Veto trade</h2>
          <p id={questionId} className="type-body-sm text-foreground-secondary mt-1">
            Are you sure you want to veto the trade between {initiatorTeam.name} and {recipientTeam.name}?
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label htmlFor={reasonId} className="type-label text-foreground-secondary">Reason (optional)</label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input mt-1 w-full h-24 resize-none"
              placeholder="Explain why you're vetoing this trade..."
            />
          </div>

          <div id={warningId} className="bg-error-bg p-3 rounded-lg">
            <p className="type-body-sm text-error">
              This action cannot be undone. The trade will be cancelled and both teams will be notified.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel veto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleVeto}
            className="btn btn-danger"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? 'Vetoing...' : 'Veto trade'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
