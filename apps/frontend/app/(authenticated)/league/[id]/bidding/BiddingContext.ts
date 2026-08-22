'use client'

import { createContext, useContext } from 'react'
import type { CounterpickBid, DroppableHolding, League, PickupBid, TeamWithOwner } from '@/types'
import type { UseBiddingReturn } from '../hooks/useBidding'

/**
 * State the bidding tabs share. It lives in the segment layout rather than in
 * either tab so that moving between Active and History keeps one useBidding
 * subscription alive instead of tearing it down and refetching on every switch.
 */
export interface BiddingContextValue {
  league: League
  teamId: string
  /** Every active team in the league, for naming bidders in results. */
  teams: TeamWithOwner[]
  bidding: UseBiddingReturn
  ownedTmdbIds: number[]
  /**
   * Active holdings across the whole roster -- draft picks and pickups alike,
   * since they share `total_slots`.
   */
  usedRosterSlots: number
  /** Roster slots still open. Zero means a bid needs a conditional drop to land. */
  freeRosterSlots: number
  /** The team's own holdings, offered as conditional drop targets. */
  myHoldings: DroppableHolding[]
  biddingCounterpickSlots: number
  /**
   * True once the week's new-bid cutoff has passed: only raises and counters on
   * movies already being bid on, and nothing can be withdrawn.
   */
  isCounterBidPhase: boolean
  /**
   * Whether opening the bid modal leads anywhere. A full roster no longer closes
   * it -- a bid can still be placed with a conditional drop, or in the
   * expectation that a slot frees up before processing. Past the cutoff it does
   * need a contest to join, since the modal offers only movies already in play.
   */
  canOpenBidModal: boolean
  /** False when counterpicks are off, or the team's counterpick slots are all claimed. */
  canPlaceCounterpickBid: boolean
  /** Opens the bid modal, optionally pre-aimed at a bid to outbid. */
  openPlaceBid: (target?: PickupBid | null) => void
  openCounterpickBid: (target?: CounterpickBid | null) => void
}

const BiddingContext = createContext<BiddingContextValue | null>(null)

export const BiddingProvider = BiddingContext.Provider

export function useBiddingContext(): BiddingContextValue {
  const context = useContext(BiddingContext)
  if (!context) {
    throw new Error('useBiddingContext must be used inside the bidding layout')
  }
  return context
}
