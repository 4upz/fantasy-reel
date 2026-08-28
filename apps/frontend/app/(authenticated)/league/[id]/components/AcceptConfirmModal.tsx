'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { TradeOfferWithTeams, TradeItems, TradeMovieItem } from '@/types'

interface Props {
  trade: TradeOfferWithTeams
  currentTeamId: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

/** @design-system Modals */
export default function AcceptConfirmModal({
  trade,
  currentTeamId,
  onClose,
  onConfirm,
}: Props) {
  const isInitiator = trade.initiator_team_id === currentTeamId
  const initiatorTeam = trade.initiator_team as { id: string; name: string; avatar_url: string | null }
  const recipientTeam = trade.recipient_team as { id: string; name: string; avatar_url: string | null }

  // Determine what the current user gives and receives
  const youGive = isInitiator
    ? (trade.initiator_items as TradeItems)
    : (trade.recipient_items as TradeItems)
  const youReceive = isInitiator
    ? (trade.recipient_items as TradeItems)
    : (trade.initiator_items as TradeItems)

  const otherTeamName = isInitiator ? recipientTeam.name : initiatorTeam.name

  const { execute: handleConfirm, isLoading } = useAsyncAction(onConfirm)

  // Handle escape key to close modal
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
    <div
      className="modal-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accept-confirm-title"
    >
      <div className="modal-panel glass rounded-lg shadow-heavy max-w-lg w-full border border-border">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <h2 id="accept-confirm-title" className="text-lg font-display font-bold text-foreground">Confirm Trade</h2>
          <p className="text-sm text-foreground-secondary mt-1">
            Review the trade details before accepting.
          </p>
        </div>

        {/* Trade summary */}
        <div className="p-4 space-y-4">
          {/* What you give */}
          <div className="p-3 rounded-lg bg-crimson/10 border border-crimson/30">
            <p className="text-sm font-medium text-foreground-secondary mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-crimson" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              You send to {otherTeamName}
            </p>
            <TradeItemsList items={youGive} />
          </div>

          {/* What you receive */}
          <div className="p-3 rounded-lg bg-success/10 border border-success/30">
            <p className="text-sm font-medium text-foreground-secondary mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
              </svg>
              You receive from {otherTeamName}
            </p>
            <TradeItemsList items={youReceive} />
          </div>

          {/* Warning */}
          <div className="p-3 rounded-lg bg-warning-bg border border-warning/30">
            <p className="text-sm text-warning">
              This action cannot be undone. The trade will enter review period and complete automatically if not vetoed.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={isLoading}
            aria-label="Cancel acceptance"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="btn btn-primary"
            disabled={isLoading}
            aria-label={isLoading ? 'Accepting trade...' : 'Confirm accept trade'}
            aria-busy={isLoading}
          >
            {isLoading ? 'Accepting...' : 'Confirm Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TradeItemsList({ items }: { items: TradeItems }) {
  const hasMovies = items.movies.length > 0
  const hasBudget = items.faab > 0

  if (!hasMovies && !hasBudget) {
    return <p className="text-sm text-foreground-muted italic">Nothing</p>
  }

  return (
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

      {hasBudget && (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gold/20 rounded flex items-center justify-center">
            <span className="text-gold font-bold text-sm">$</span>
          </div>
          <p className="text-sm font-medium text-gold">${items.faab} budget</p>
        </div>
      )}
    </div>
  )
}
