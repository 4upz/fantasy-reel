'use client'

import { useCallback, useMemo } from 'react'
import { Target } from 'lucide-react'
import type { CounterpickBid } from '@/types'
import PriorityList, { type PriorityListItem } from './PriorityList'

interface CounterpickPriorityListProps {
  /** The team's pending counterpick bids, already in priority order. */
  bids: CounterpickBid[]
  /** Counterpick slots the league grants each team for the bidding phase. */
  slots: number
  /** Bidding counterpicks the team already holds. */
  used: number
  onReorder: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

export default function CounterpickPriorityList({
  bids,
  slots,
  used,
  onReorder,
}: CounterpickPriorityListProps): React.ReactElement | null {
  const remainingSlots = Math.max(0, slots - used)

  const items = useMemo<PriorityListItem[]>(
    () => bids.map((bid) => ({
      id: bid.id,
      title: bid.movies?.title || 'Unknown movie',
      meta: (
        <>
          <Target className="w-3 h-3 text-crimson shrink-0" />
          <span className="truncate">vs {bid.target_team?.name || 'Unknown team'}</span>
          <span className="text-foreground-muted">·</span>
          <span className="text-foreground-muted">${bid.amount}</span>
        </>
      ),
    })),
    [bids]
  )

  /**
   * Counterpicks have no conditional drops, so capacity is a plain count: the
   * first `remainingSlots` bids fit and the rest do not.
   */
  const computeFits = useCallback(
    (ordered: PriorityListItem[]): boolean[] =>
      ordered.map((_, index) => index < remainingSlots),
    [remainingSlots]
  )

  return (
    <PriorityList
      items={items}
      computeFits={computeFits}
      heading="Counterpick priority"
      description={
        remainingSlots > 0
          ? `If more of your bids win than you have slots for, you keep the top ${remainingSlots}.`
          : 'Your counterpick slots are full, so these bids will pass to the next-highest bidder.'
      }
      cutLabel="Slots run out"
      testId="counterpick-priority-list"
      cutTestId="counterpick-slot-cut-line"
      onReorder={onReorder}
    />
  )
}
