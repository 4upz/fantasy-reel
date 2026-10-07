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
  /** Drop allowance left after all drops already executed this season. */
  remainingDrops: number
  /** Current holdings that can supply room when no open slot remains. */
  droppableHoldingIds: ReadonlySet<string>
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
  remainingDrops,
  droppableHoldingIds,
  disabled,
  onReorder,
}: BidPriorityListProps): React.ReactElement | null {
  const remainingSlots = Math.max(0, slots - used)

  const dropTargetById = useMemo(
    () => new Map(bids.map((bid) => [bid.id, conditionalDropOf(bid)])),
    [bids]
  )

  const computeFunding = useCallback(
    (ordered: { id: string }[]) => forecastBidFits(
      ordered.map((item) => dropTargetById.get(item.id) ?? null),
      { freeSlots: remainingSlots, remainingDrops, droppableHoldingIds },
    ),
    [remainingSlots, remainingDrops, droppableHoldingIds, dropTargetById]
  )

  const items = useMemo<PriorityListItem[]>(
    () => {
      const funding = computeFunding(bids)
      return bids.map((bid, index) => ({
        id: bid.id,
        title: bid.movie_data?.title || 'Unknown movie',
        meta: (
          <>
            <span className="type-numeric text-foreground-secondary"><span className="sr-only">Bid: </span>${bid.amount}</span>
            <span aria-hidden="true">·</span>
            {funding[index] === 'drop' && (
              <Scissors className="w-3 h-3 text-warning shrink-0" aria-hidden="true" />
            )}
            <span className={funding[index] === 'drop' ? 'text-warning' : undefined}>
              {funding[index] === 'drop'
                ? 'Uses conditional drop'
                : funding[index] === 'slot' ? 'Uses open slot' : 'No room currently'}
            </span>
          </>
        ),
      }))
    },
    [bids, computeFunding]
  )

  /**
   * Not the counterpick list's `index < remainingSlots`: a conditional drop can
   * bring its own room, once per holding. See forecastBidFits.
   */
  const computeFits = useCallback(
    (ordered: PriorityListItem[]): boolean[] =>
      computeFunding(ordered).map((funding) => funding !== null),
    [computeFunding]
  )

  return (
    <PriorityList
      items={items}
      computeFits={computeFits}
      heading="Pickup bids"
      description={`If these bids win in this order, they use your ${remainingSlots} open ${remainingSlots === 1 ? 'slot' : 'slots'} first, then eligible drops (${remainingDrops} left). Budget and other bids can change the result.`}
      cutLabel="Roster runs out"
      testId="bid-priority-list"
      cutTestId="bid-slot-cut-line"
      onReorder={onReorder}
      disabled={disabled}
    />
  )
}
