'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useBiddingContext } from '../bidding/BiddingContext'
import BidPriorityList from './BidPriorityList'
import CounterpickPriorityList from './CounterpickPriorityList'

// Preserve the draft order while live updates refresh details and pending bids.
function orderBids<T extends { id: string }>(bids: T[], ids: string[]): T[] {
  const ranks = new Map(ids.map((id, index) => [id, index]))
  return [...bids].sort((a, b) =>
    (ranks.get(a.id) ?? ids.length) - (ranks.get(b.id) ?? ids.length)
  )
}

export default function BidPriorityModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { league, bidding, usedRosterSlots, biddingCounterpickSlots } = useBiddingContext()
  const { myBids, myCounterpickBids, biddingCounterpickCount, setBidPriorities, setCounterpickBidPriorities } = bidding
  const [priorityOrder, setPriorityOrder] = useState(() => ({
    pickup: myBids.map((bid) => bid.id),
    counterpick: myCounterpickBids.map((bid) => bid.id),
  }))
  const [hasSavedChanges, setHasSavedChanges] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropPressed = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  const savePriorityAction = useCallback(async () => {
    const groups = [
      { bids: myBids, ids: priorityOrder.pickup, save: setBidPriorities },
      { bids: myCounterpickBids, ids: priorityOrder.counterpick, save: setCounterpickBidPriorities },
    ]
    for (const { bids, ids, save } of groups) {
      const orderedIds = orderBids<{ id: string }>(bids, ids).map((bid) => bid.id)
      if (orderedIds.every((id, index) => id === bids[index].id)) continue
      const result = await save(orderedIds)
      if (!result.success) throw new Error('Could not save priority. Your unsaved changes are still here. Try again.')
      setHasSavedChanges(true)
    }
    onClose()
  }, [priorityOrder, myBids, myCounterpickBids, setBidPriorities, setCounterpickBidPriorities, onClose])
  const { execute: savePriority, isLoading: isSaving, error } = useAsyncAction(savePriorityAction)

  const close = () => {
    if (!isSaving) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="bid-priority-title"
      aria-describedby="bid-priority-description"
      data-testid="bid-priority-modal"
      className="glass modal-panel fixed inset-0 m-auto w-[calc(100%-32px)] max-w-xl max-h-[85dvh] flex-col overflow-hidden rounded-2xl border border-border p-0 text-foreground shadow-heavy open:flex backdrop:bg-overlay backdrop:backdrop-blur-sm motion-reduce:animate-none"
      onCancel={(event) => { event.preventDefault(); close() }}
      onKeyDownCapture={(event) => {
        // Escape cancels the active drag before it can dismiss the dialog.
        if (event.key === 'Escape' && event.currentTarget.querySelector('[aria-roledescription="sortable"][aria-pressed="true"]')) {
          event.preventDefault()
        }
      }}
      onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget }}
      onClick={(event) => {
        if (backdropPressed.current && event.target === event.currentTarget) close()
        backdropPressed.current = false
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div>
          <h2 id="bid-priority-title" className="type-panel">Edit bid priority</h2>
          <p id="bid-priority-description" className="type-body-sm text-foreground-secondary mt-1">
            Put your favorites first. Priority decides which winning bids you keep when slots or budget run out.
          </p>
        </div>
        <button type="button" onClick={close} disabled={isSaving} className="btn btn-ghost h-11 w-11 shrink-0 rounded-full p-2" aria-label="Close priority editor">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain space-y-6 p-4 sm:p-5" aria-busy={isSaving}>
        <p className="type-meta text-foreground-secondary">Drag the handles or choose a priority number.</p>
        <BidPriorityList
          bids={orderBids(myBids, priorityOrder.pickup)}
          slots={league.total_slots}
          used={usedRosterSlots}
          disabled={isSaving}
          onReorder={(pickup) => setPriorityOrder((current) => ({ ...current, pickup }))}
        />
        {biddingCounterpickSlots > 0 && (
          <CounterpickPriorityList
            bids={orderBids(myCounterpickBids, priorityOrder.counterpick)}
            slots={biddingCounterpickSlots}
            used={biddingCounterpickCount}
            disabled={isSaving}
            onReorder={(counterpick) => setPriorityOrder((current) => ({ ...current, counterpick }))}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border p-4 sm:p-5">
        {error && (
          <p role="alert" className="alert-error type-body-sm mb-3 rounded-lg p-3">
            {hasSavedChanges && 'Some priorities were saved. '}{error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={close} disabled={isSaving} className="btn btn-secondary min-h-11 px-4 py-2">
            {hasSavedChanges ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            data-testid="save-bid-priority"
            disabled={isSaving}
            className="btn btn-primary min-h-11 px-4 py-2"
            onClick={() => { void savePriority().catch(() => { /* The error is shown above. */ }) }}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            {isSaving ? 'Saving…' : 'Save priority'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
