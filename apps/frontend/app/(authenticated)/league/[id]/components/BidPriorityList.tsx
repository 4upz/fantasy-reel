'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ListOrdered, Scissors } from 'lucide-react'
import { toast } from 'sonner'
import type { PickupBid } from '@/types'

interface BidPriorityListProps {
  /** The team's pending pickup bids, already in priority order. */
  bids: PickupBid[]
  /** Roster slots the league grants each team. Draft picks and pickups share them. */
  slots: number
  /** Roster slots the team has already filled. */
  used: number
  onReorder: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

/** Saving on every keypress would spam the endpoint mid-reshuffle. */
const SAVE_DEBOUNCE_MS = 400

function move<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function hasConditionalDrop(bid: PickupBid): boolean {
  return bid.conditional_drop_pickup_id !== null || bid.conditional_drop_draft_pick_id !== null
}

/**
 * Which bids the team could actually keep, walked in priority order.
 *
 * A plain bid consumes a roster slot. A bid carrying a conditional drop brings
 * its own room -- the movie arriving and the movie leaving cancel out -- so it
 * always fits and never spends a slot. That is why this cannot be the simple
 * `index < remainingSlots` test the counterpick list uses: a drop-carrying bid
 * ranked last still lands, and drawing a cut line above it would be a lie.
 *
 * This mirrors `consume()` in _shared/bid-resolution.ts. It is a forecast, not a
 * promise: budget, and whether the drop target is still droppable at processing
 * time, are settled server-side.
 */
function forecastFit(bids: PickupBid[], remainingSlots: number): boolean[] {
  let slotsLeft = remainingSlots

  return bids.map((bid) => {
    if (hasConditionalDrop(bid)) return true
    if (slotsLeft > 0) {
      slotsLeft -= 1
      return true
    }
    return false
  })
}

export default function BidPriorityList({
  bids,
  slots,
  used,
  onReorder,
}: BidPriorityListProps): React.ReactElement | null {
  // Held locally so a reorder lands instantly; the server order flows back in via
  // the `bids` prop once the save completes.
  const [order, setOrder] = useState(bids)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(bids.map((bid) => bid.id).join(','))

  useEffect(() => {
    const incoming = bids.map((bid) => bid.id).join(',')
    // Ignore the echo of our own save so it cannot fight the local order.
    if (incoming !== lastSaved.current) {
      setOrder(bids)
      lastSaved.current = incoming
    }
  }, [bids])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const remainingSlots = Math.max(0, slots - used)

  const save = useCallback(async (
    next: PickupBid[],
    previous: PickupBid[],
  ) => {
    const nextIds = next.map((bid) => bid.id)
    lastSaved.current = nextIds.join(',')

    const { success, error } = await onReorder(nextIds)
    if (!success) {
      setOrder(previous)
      lastSaved.current = previous.map((bid) => bid.id).join(',')
      toast.error(error || 'Could not save bid priority')
    }
  }, [onReorder])

  const moveBid = useCallback((from: number, to: number) => {
    if (to < 0 || to >= order.length) return

    const next = move(order, from, to)
    setOrder(next)

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(next, order), SAVE_DEBOUNCE_MS)
  }, [order, save])

  // One bid cannot collide with anything, so the ordering control has no job.
  if (order.length < 2) return null

  const fits = forecastFit(order, remainingSlots)
  // The first bid that needs room it does not have. Nothing below it can land
  // without a drop, so that is where the line belongs.
  const cutIndex = fits.indexOf(false)

  return (
    <div className="card p-4 sm:p-5 space-y-4" data-testid="bid-priority-list">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-gold" />
          <h3 className="font-display font-semibold text-foreground">
            Bid priority
          </h3>
        </div>
        <p className="text-sm text-foreground-secondary">
          {remainingSlots > 0
            ? `If more of your bids win than you have room for, you keep the top ${remainingSlots}.`
            : 'Your roster is full. Only bids with a movie to drop can be honored.'}
        </p>
      </div>

      <ol className="space-y-2">
        {order.map((bid, index) => {
          const willFit = fits[index]
          const movieTitle = bid.movie_data?.title || 'Unknown movie'
          const dropsAMovie = hasConditionalDrop(bid)

          return (
            <li key={bid.id}>
              {/* Marks where the roster runs out; never renders when every bid fits. */}
              {index === cutIndex && (
                <div
                  className="flex items-center gap-2 py-2"
                  data-testid="bid-slot-cut-line"
                >
                  <Scissors className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                  <span className="text-xs uppercase tracking-wide text-foreground-muted whitespace-nowrap">
                    Roster runs out
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}

              <div
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  willFit
                    ? 'border-border bg-elevated'
                    : 'border-border/60 bg-surface opacity-60'
                }`}
              >
                <span
                  className={`font-mono text-sm w-6 text-center shrink-0 ${
                    willFit ? 'text-gold' : 'text-foreground-muted'
                  }`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{movieTitle}</p>
                  <p className="text-xs text-foreground-secondary mt-0.5 flex items-center gap-1">
                    <span className="text-foreground-muted">${bid.amount}</span>
                    {dropsAMovie && (
                      <>
                        <span className="text-foreground-muted">·</span>
                        <Scissors className="w-3 h-3 text-warning shrink-0" />
                        <span className="truncate text-warning">Brings its own slot</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveBid(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${movieTitle} up to priority ${index}`}
                    className="p-1 rounded text-foreground-secondary hover:text-gold hover:bg-surface-hover disabled:opacity-30 disabled:hover:text-foreground-secondary disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBid(index, index + 1)}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${movieTitle} down to priority ${index + 2}`}
                    className="p-1 rounded text-foreground-secondary hover:text-gold hover:bg-surface-hover disabled:opacity-30 disabled:hover:text-foreground-secondary disabled:hover:bg-transparent transition-colors focus-visible:outline-2 focus-visible:outline-gold"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
