'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { createClient } from '@/utils/supabase/client'
import { useBiddingContext } from '../bidding/BiddingContext'
import { getDroppableBidHoldingIds } from './bidFitForecast'
import BidPriorityList from './BidPriorityList'
import CounterpickPriorityList from './CounterpickPriorityList'

interface PickupCapacity {
  slots: number
  used: number
  remainingDrops: number
  droppableHoldingIds: ReadonlySet<string>
}

// Preserve the draft order while live updates refresh details and pending bids.
function orderBids<T extends { id: string }>(bids: T[], ids: string[]): T[] {
  const ranks = new Map(ids.map((id, index) => [id, index]))
  return [...bids].sort((a, b) =>
    (ranks.get(a.id) ?? ids.length) - (ranks.get(b.id) ?? ids.length)
  )
}

/**
 * `onClose` carries a confirmation after a successful save, for the opener to
 * show once the dialog -- and the page's inertness -- is gone.
 */
export default function BidPriorityModal({ onClose }: { onClose: (successMessage?: string) => void }): React.ReactElement {
  const { league, teamId, bidding, biddingCounterpickSlots } = useBiddingContext()
  const { myBids, myCounterpickBids, biddingCounterpickCount, setBidPriorities, setCounterpickBidPriorities } = bidding
  const hasPickupBids = myBids.length > 0
  const supabase = useMemo(() => createClient(), [])
  const [pickupCapacity, setPickupCapacity] = useState<PickupCapacity | null>(null)
  const [priorityOrder, setPriorityOrder] = useState(() => ({
    pickup: myBids.map((bid) => bid.id),
    counterpick: myCounterpickBids.map((bid) => bid.id),
  }))
  const [hasSavedChanges, setHasSavedChanges] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const capacityStatusId = useId()

  // Layout data can outlive a drop or trade in another tab. Read a fresh
  // snapshot on each opening before claiming that any pickup bid will fit.
  const loadCapacity = useCallback(async () => {
    setPickupCapacity(null)
    const [holdings, drops, counterpicks, settings] = await Promise.all([
      supabase.from('team_holdings')
        .select('holding_id, movie_id, release_date, counterpicked_by_team_id')
        .eq('team_id', teamId),
      supabase.rpc('get_team_drop_count', { p_team_id: teamId }),
      supabase.from('counterpick_bids').select('movie_id')
        .eq('league_id', league.id).in('status', ['active', 'outbid']),
      supabase.from('leagues').select('total_slots, drop_limit, counterpicks_block_drops')
        .eq('id', league.id).single(),
    ])
    if (holdings.error || drops.error || counterpicks.error || settings.error || !settings.data) {
      throw new Error('Could not load your current roster and drop allowance. Try again.')
    }
    const currentHoldings = holdings.data ?? []
    setPickupCapacity({
      slots: settings.data.total_slots,
      used: currentHoldings.length,
      remainingDrops: Math.max(0, settings.data.drop_limit - (drops.data ?? 0)),
      droppableHoldingIds: getDroppableBidHoldingIds(currentHoldings, {
        today: new Date().toISOString().slice(0, 10),
        counterpicksBlockDrops: settings.data.counterpicks_block_drops,
        contestedMovieIds: new Set((counterpicks.data ?? []).map((bid) => bid.movie_id)),
      }),
    })
  }, [supabase, teamId, league.id])
  const { execute: refreshCapacity, isLoading: isLoadingCapacity, error: capacityError } = useAsyncAction(loadCapacity)

  useEffect(() => {
    if (!hasPickupBids) return
    void refreshCapacity().catch(() => { /* The retry state is shown in the dialog. */ })
  }, [refreshCapacity, hasPickupBids])

  const savePriorityAction = useCallback(async () => {
    const groups = [
      { bids: myBids, ids: priorityOrder.pickup, save: setBidPriorities },
      { bids: myCounterpickBids, ids: priorityOrder.counterpick, save: setCounterpickBidPriorities },
    ]
    let saved = false
    for (const { bids, ids, save } of groups) {
      const orderedIds = orderBids<{ id: string }>(bids, ids).map((bid) => bid.id)
      if (orderedIds.every((id, index) => id === bids[index].id)) continue
      const result = await save(orderedIds)
      if (!result.success) throw new Error('Could not save priority. Your unsaved changes are still here. Try again.')
      saved = true
      setHasSavedChanges(true)
    }
    onClose(saved ? 'Bid priority saved' : undefined)
  }, [priorityOrder, myBids, myCounterpickBids, setBidPriorities, setCounterpickBidPriorities, onClose])
  const { execute: savePriority, isLoading: isSaving, error } = useAsyncAction(savePriorityAction)

  const isSavingRef = useRef(isSaving)
  isSavingRef.current = isSaving
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const close = useCallback(() => {
    if (!isSavingRef.current) closeRef.current()
  }, [])

  // Listeners are attached here rather than as JSX props: the dialog element
  // itself is not a control, and a press that starts on a dragged item and
  // ends on the backdrop must not count as a backdrop click.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    let backdropPressed = false
    const handleCancel = (event: Event) => {
      event.preventDefault()
      close()
    }
    // Escape cancels the active drag before it can dismiss the dialog.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dialog.querySelector('[aria-roledescription="sortable"][aria-pressed="true"]')) {
        event.preventDefault()
      }
    }
    const handlePointerDown = (event: PointerEvent) => { backdropPressed = event.target === dialog }
    const handleClick = (event: MouseEvent) => {
      if (backdropPressed && event.target === dialog) close()
      backdropPressed = false
    }
    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('keydown', handleKeyDown, true)
    dialog.addEventListener('pointerdown', handlePointerDown)
    dialog.addEventListener('click', handleClick)
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('keydown', handleKeyDown, true)
      dialog.removeEventListener('pointerdown', handlePointerDown)
      dialog.removeEventListener('click', handleClick)
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [close])

  // Save stays focusable while it can't run (aria-disabled), so focus isn't
  // dropped mid-save and the reason it's unavailable can be heard.
  const waitingForCapacity = hasPickupBids && !pickupCapacity
  const saveUnavailable = isSaving || waitingForCapacity
  const handleSave = () => {
    if (saveUnavailable) return
    void savePriority().catch(() => { /* The error is shown above. */ })
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="bid-priority-title"
      aria-describedby="bid-priority-description"
      data-testid="bid-priority-modal"
      className="glass modal-panel fixed inset-0 m-auto w-[calc(100%-32px)] max-w-xl max-h-[85dvh] flex-col overflow-hidden rounded-2xl border border-border p-0 text-foreground shadow-heavy open:flex backdrop:bg-overlay backdrop:backdrop-blur-sm motion-reduce:animate-none"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div>
          <h2 ref={titleRef} id="bid-priority-title" tabIndex={-1} className="type-panel focus:outline-none">Edit bid priority</h2>
          <p id="bid-priority-description" className="type-body-sm text-foreground-secondary mt-1">
            Put your favorites first. Priority decides which winning bids you keep when slots or budget run out.
            {' '}Outbid bids can still win if higher bids cannot be honored.
          </p>
        </div>
        <button type="button" onClick={close} disabled={isSaving} className="btn btn-ghost h-11 w-11 shrink-0 rounded-full p-2" aria-label="Close priority editor">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain space-y-6 p-4 sm:p-5" aria-busy={isSaving}>
        <p className="type-meta text-foreground-secondary">Drag the handles or choose a priority number.</p>
        {hasPickupBids && (capacityError ? (
          <div className="alert-error type-body-sm rounded-lg p-3" role="alert">
            <p>{capacityError}</p>
            <button
              type="button"
              className="btn btn-secondary mt-3 min-h-11 px-4 py-2"
              disabled={isLoadingCapacity}
              onClick={() => {
                // The retry replaces this alert, button and all, with a loading
                // status; keep focus in the dialog rather than losing it.
                titleRef.current?.focus()
                void refreshCapacity().catch(() => { /* The error remains available for retry. */ })
              }}
            >
              Try again
            </button>
          </div>
        ) : pickupCapacity ? (
          <BidPriorityList
            bids={orderBids(myBids, priorityOrder.pickup)}
            {...pickupCapacity}
            disabled={isSaving}
            onReorder={(pickup) => setPriorityOrder((current) => ({ ...current, pickup }))}
          />
        ) : (
          <p id={capacityStatusId} className="type-body-sm text-foreground-secondary flex items-center gap-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your current roster and drop allowance…
          </p>
        ))}
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
            aria-disabled={saveUnavailable}
            aria-describedby={waitingForCapacity && !capacityError ? capacityStatusId : undefined}
            className="btn btn-primary min-h-11 px-4 py-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-gold aria-disabled:hover:shadow-none"
            onClick={handleSave}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            {isSaving ? 'Saving…' : 'Save priority'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
