'use client'

import { useCallback, useMemo } from 'react'
import { Scissors } from 'lucide-react'
import type { PickupBid } from '@/types'
import PriorityList, { type PriorityListItem } from './PriorityList'

interface BidPriorityListProps {
  /** The team's pending pickup bids, already in priority order. */
  bids: PickupBid[]
  /** Roster slots the league grants each team. Draft picks and pickups share them. */
  slots: number
  /** Roster slots the team has already filled. */
  used: number
  onReorder: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

function hasConditionalDrop(bid: PickupBid): boolean {
  return bid.conditional_drop_pickup_id !== null || bid.conditional_drop_draft_pick_id !== null
}

export default function BidPriorityList({
  bids,
  slots,
  used,
  onReorder,
}: BidPriorityListProps): React.ReactElement | null {
  const remainingSlots = Math.max(0, slots - used)

  const items = useMemo<PriorityListItem[]>(
    () => bids.map((bid) => ({
      id: bid.id,
      title: bid.movie_data?.title || 'Unknown movie',
      meta: (
        <>
          <span className="text-foreground-muted">${bid.amount}</span>
          {hasConditionalDrop(bid) && (
            <>
              <span className="text-foreground-muted">·</span>
              <Scissors className="w-3 h-3 text-warning shrink-0" />
              <span className="truncate text-warning">Brings its own slot</span>
            </>
          )}
        </>
      ),
    })),
    [bids]
  )

  const dropCarriers = useMemo(
    () => new Set(bids.filter(hasConditionalDrop).map((bid) => bid.id)),
    [bids]
  )

  /**
   * Walk the list in priority order, spending roster slots.
   *
   * A plain bid consumes a slot. A bid carrying a conditional drop brings its
   * own room -- the movie arriving and the movie leaving cancel out -- so it
   * always fits and never spends one. That is why this cannot be the simple
   * `index < remainingSlots` test the counterpick list uses: a drop-carrying bid
   * ranked last still lands, and drawing a cut line above it would be a lie.
   *
   * Mirrors `consume()` in _shared/bid-resolution.ts. It is a forecast, not a
   * promise: budget, and whether the drop target is still droppable at
   * processing time, are settled server-side.
   */
  const computeFits = useCallback((ordered: PriorityListItem[]): boolean[] => {
    let slotsLeft = remainingSlots

    return ordered.map((item) => {
      if (dropCarriers.has(item.id)) return true
      if (slotsLeft > 0) {
        slotsLeft -= 1
        return true
      }
      return false
    })
  }, [remainingSlots, dropCarriers])

  return (
    <PriorityList
      items={items}
      computeFits={computeFits}
      heading="Bid priority"
      description={
        remainingSlots > 0
          ? `If more of your bids win than you have room for, you keep the top ${remainingSlots}.`
          : 'Your roster is full. Only bids with a movie to drop can be honored.'
      }
      cutLabel="Roster runs out"
      testId="bid-priority-list"
      cutTestId="bid-slot-cut-line"
      onReorder={onReorder}
    />
  )
}
