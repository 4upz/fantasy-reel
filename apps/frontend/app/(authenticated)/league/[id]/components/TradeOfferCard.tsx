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

export default function TradeOfferCard({
  trade,
  currentTeamId,
  isOwner,
  onRespond,
  onCancel,
  onVeto,
}: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
                onClick={() => handleAction('accept')}
                disabled={isLoading}
                className="btn btn-primary"
              >
                {isLoading ? 'Processing...' : 'Accept'}
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
              onClick={() => {
                const reason = window.prompt('Enter veto reason (optional):')
                handleAction('veto', reason || undefined)
              }}
              disabled={isLoading}
              className="btn btn-danger"
            >
              Veto Trade
            </button>
          )}
        </div>
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
