'use client'

import { useCallback, useMemo } from 'react'
import { Scissors } from 'lucide-react'
import type { PickupBid } from '@/types'
import PriorityList, { type PriorityListItem } from './PriorityList'
import { forecastBidFits } from './bidFitForecast'

interface BidPriorityListProps {
  /** The team's pending pickup bids, already in priority order. */
  bids: PickupBid[]
  /** Roster slots the league grants each team. Draft picks and pickups share them. */
  slots: number
  /** Roster slots the team has already filled. */
  used: number
  disabled: boolean
  onReorder: (bidIds: string[]) => void
}

/** The holding this bid drops if it wins, or null when it carries no conditional drop. */
function conditionalDropOf(bid: PickupBid): string | null {
  return bid.conditional_drop_pickup_id ?? bid.conditional_drop_draft_pick_id ?? null
}

/** @design-system League */
export default function BidPriorityList({
  bids,
  slots,
  used,
  disabled,
  onReorder,
}: BidPriorityListProps): React.ReactElement | null {
  const remainingSlots = Math.max(0, slots - used)

  const items = useMemo<PriorityListItem[]>(
    () => bids.map((bid) => ({
      id: bid.id,
      title: bid.movie_data?.title || 'Unknown movie',
      meta: (
        <>
          <span className="type-numeric text-foreground-secondary">${bid.amount}</span>
          {conditionalDropOf(bid) !== null && (
            <>
              <span className="text-foreground-secondary">·</span>
              <Scissors className="w-3 h-3 text-warning shrink-0" />
              <span className="truncate text-warning">Brings its own slot</span>
            </>
          )}
        </>
      ),
    })),
    [bids]
  )

  const dropTargetById = useMemo(
    () => new Map(bids.map((bid) => [bid.id, conditionalDropOf(bid)])),
    [bids]
  )

  /**
   * Not the counterpick list's `index < remainingSlots`: a conditional drop can
   * bring its own room, once per holding. See forecastBidFits.
   */
  const computeFits = useCallback(
    (ordered: PriorityListItem[]): boolean[] =>
      forecastBidFits(ordered.map((item) => dropTargetById.get(item.id) ?? null), remainingSlots),
    [remainingSlots, dropTargetById]
  )

  return (
    <PriorityList
      items={items}
      computeFits={computeFits}
      heading="Pickup bids"
      description={
        remainingSlots > 0
          ? `If more of your bids win than you have room for, you keep the top ${remainingSlots}.`
          : 'Your roster is full. Only bids with a movie to drop can be honored.'
      }
      cutLabel="Roster runs out"
      testId="bid-priority-list"
      cutTestId="bid-slot-cut-line"
      onReorder={onReorder}
      disabled={disabled}
    />
  )
}
