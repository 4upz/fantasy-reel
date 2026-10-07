'use client'

import { useId } from 'react'
import Modal from '@/app/components/Modal'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { TradeOfferWithTeams, TradeItems } from '@/types'
import { TradeItemsList } from './TradeItemsSection'

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

  const titleId = useId()
  const summaryId = useId()

  return (
    <Modal onClose={onClose} preventClose={isLoading} labelledBy={titleId} describedBy={summaryId}>
      <div className="modal-panel glass max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain rounded-lg shadow-heavy max-w-lg w-full border border-border [overflow-wrap:anywhere]">
        {/* Header */}
        <div className="p-[min(1rem,16px)] border-b border-border">
          <h2 id={titleId} className="type-panel text-foreground">Confirm trade</h2>
          <p className="type-body-sm text-foreground-secondary mt-1">
            Review the trade details before accepting.
          </p>
        </div>

        {/* Trade summary -- the dialog's description, so it is read on open. */}
        <div id={summaryId} className="p-[min(1rem,16px)] space-y-4">
          {/* What you give */}
          <div className="p-[min(.75rem,12px)] rounded-lg bg-crimson/10 border border-crimson/30">
            <h3 className="type-label text-foreground-secondary mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-crimson-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              You send to {otherTeamName}
            </h3>
            <TradeItemsList items={youGive} />
          </div>

          {/* What you receive */}
          <div className="p-[min(.75rem,12px)] rounded-lg bg-success/10 border border-success/30">
            <h3 className="type-label text-foreground-secondary mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
              </svg>
              You receive from {otherTeamName}
            </h3>
            <TradeItemsList items={youReceive} />
          </div>

          {/* Warning */}
          <div className="p-[min(.75rem,12px)] rounded-lg bg-warning-bg border border-warning/30">
            <p className="type-body-sm text-warning">
              This action cannot be undone. The trade will enter review period and complete automatically if not vetoed.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-[min(1rem,16px)] border-t border-border flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost min-w-0 max-w-full"
            disabled={isLoading}
            aria-label="Cancel acceptance"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="btn btn-primary min-w-0 max-w-full"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? 'Accepting...' : 'Confirm accept'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
