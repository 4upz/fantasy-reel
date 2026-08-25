'use client'

import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Plus, Swords, Target } from 'lucide-react'
import type { CounterpickBid, DroppableHolding, League, PickupBid, TeamWithOwner } from '@/types'
import { useBidding } from '../hooks/useBidding'
import BidWeekTimeline from '../components/BidWeekTimeline'
import { getBidPhase } from '../components/utils'
import { BiddingProvider } from './BiddingContext'

function ModalLoadingFallback(): React.ReactElement {
  return (
    <div className="modal-overlay">
      <div className="animate-pulse h-[85vh] max-w-2xl w-full mx-4 bg-surface rounded-2xl" />
    </div>
  )
}

const PlaceBidModal = dynamic(() => import('../components/PlaceBidModal'), {
  loading: ModalLoadingFallback,
})

const PlaceCounterpickBidModal = dynamic(() => import('../components/PlaceCounterpickBidModal'), {
  loading: ModalLoadingFallback,
})

/**
 * Tabs are routes, not state, so a round of results can be linked and
 * bookmarked. `segment` is null on the index route, which sits at the bidding
 * root; every other tab is that segment's own path underneath it.
 */
const TABS = [
  { segment: null, label: 'Active' },
  { segment: 'history', label: 'History' },
] as const

interface SlotStatProps {
  label: string
  used: number
  total: number
}

/** One "used / total" stat in the header rail. */
function SlotStat({ label, used, total }: SlotStatProps): React.ReactElement {
  return (
    <div>
      <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="font-display font-bold text-2xl sm:text-3xl text-foreground tabular-nums">
          {used}
        </span>
        <span className="text-foreground-muted text-base sm:text-lg tabular-nums">/ {total}</span>
      </div>
    </div>
  )
}

/**
 * Why the bid button is disabled, or undefined when it isn't.
 *
 * A full roster is deliberately NOT a reason: a team can still bid with a
 * conditional drop, or in the expectation that a slot frees up before
 * processing. Only the new-bid cutoff with nothing in play is a genuine dead
 * end, because the modal has no movies left to offer.
 */
function getBidCtaTitle(
  isCounterBidPhase: boolean,
  hasContestedBids: boolean,
): string | undefined {
  if (isCounterBidPhase && !hasContestedBids) {
    return 'New bids are closed and no movies are currently being bid on'
  }
  return undefined
}

interface Props {
  league: League
  teamId: string
  teams: TeamWithOwner[]
  ownedTmdbIds: number[]
  /** Active holdings across the whole roster: draft picks and pickups share total_slots. */
  usedRosterSlots: number
  /** The team's own holdings, offered as conditional drop targets in the bid modal. */
  myHoldings: DroppableHolding[]
  biddingCounterpickSlots: number
  /** From get_new_bid_cutoff(); null when the league has the cutoff disabled. */
  newBidCutoffAt: string | null
  processingDeadline: string | null
  children: React.ReactNode
}

export default function BiddingShell({
  league,
  teamId,
  teams,
  ownedTmdbIds,
  usedRosterSlots,
  myHoldings,
  biddingCounterpickSlots,
  newBidCutoffAt,
  processingDeadline,
  children,
}: Props): React.ReactElement {
  const activeSegment = useSelectedLayoutSegment()
  const [isBidModalOpen, setIsBidModalOpen] = useState(false)
  const [counterBidTarget, setCounterBidTarget] = useState<PickupBid | null>(null)
  const [isCounterpickModalOpen, setIsCounterpickModalOpen] = useState(false)
  const [counterCounterpickTarget, setCounterCounterpickTarget] = useState<CounterpickBid | null>(null)

  const bidding = useBidding({ leagueId: league.id, teamId })
  const { bids, myBids, budget, counterpickBids, myCounterpickBids, biddingCounterpickCount } = bidding

  const hasCounterpicks = biddingCounterpickSlots > 0
  // Roster slots are pooled: draft picks and pickups draw on the same total.
  const rosterSlots = league.total_slots
  const freeRosterSlots = Math.max(0, rosterSlots - usedRosterSlots)

  // Only holdings that could actually be dropped are offered as conditional
  // drop targets. Mirrors drop-movie's rules (and droppableHoldingIds() in
  // _shared/bid-resolution.ts, which re-checks them at processing time):
  // offering a counterpicked movie is a dead end that would fail a week later,
  // when the bid is settled and it is too late to choose again. A released
  // movie is fair game -- it can be dropped like any other.
  const droppableHoldings = useMemo(
    () =>
      league.counterpicks_block_drops
        ? myHoldings.filter((holding) => !holding.counterpicked_by_team_id)
        : myHoldings,
    [myHoldings, league.counterpicks_block_drops]
  )
  const remainingBudget = budget?.remaining_budget ?? 100
  const canPlaceCounterpickBid = hasCounterpicks && biddingCounterpickCount < biddingCounterpickSlots

  // Past the cutoff the week belongs to counter bidding: only movies already
  // being bid on can be raised or countered, and nothing can be withdrawn.
  const { isCounterBidPhase } = useMemo(
    () => getBidPhase(newBidCutoffAt, processingDeadline),
    [newBidCutoffAt, processingDeadline]
  )

  // An 'outbid' row still counts as a live contest -- that team can counter back.
  const hasContestedBids = useMemo(
    () => bids.some((bid) => bid.status === 'active' || bid.status === 'outbid'),
    [bids]
  )

  // With no contest left to join, the bid modal has nothing to offer.
  const canOpenBidModal = !isCounterBidPhase || hasContestedBids

  const totalPendingBids = useMemo(
    () => [...myBids, ...myCounterpickBids]
      .filter((bid) => bid.status === 'active' || bid.status === 'outbid')
      .reduce((sum, bid) => sum + bid.amount, 0),
    [myBids, myCounterpickBids]
  )

  const openPlaceBid = useCallback((target?: PickupBid | null) => {
    setCounterBidTarget(target ?? null)
    setIsBidModalOpen(true)
  }, [])

  const openCounterpickBid = useCallback((target?: CounterpickBid | null) => {
    setCounterCounterpickTarget(target ?? null)
    setIsCounterpickModalOpen(true)
  }, [])

  const contextValue = useMemo(
    () => ({
      league,
      teamId,
      teams,
      bidding,
      ownedTmdbIds,
      usedRosterSlots,
      freeRosterSlots,
      myHoldings,
      biddingCounterpickSlots,
      canPlaceCounterpickBid,
      isCounterBidPhase,
      canOpenBidModal,
      openPlaceBid,
      openCounterpickBid,
    }),
    [
      league,
      teamId,
      teams,
      bidding,
      ownedTmdbIds,
      usedRosterSlots,
      freeRosterSlots,
      myHoldings,
      biddingCounterpickSlots,
      canPlaceCounterpickBid,
      isCounterBidPhase,
      canOpenBidModal,
      openPlaceBid,
      openCounterpickBid,
    ]
  )

  return (
    <BiddingProvider value={contextValue}>
      <div className="space-y-6" data-testid="bidding-panel">
        {/* Header: budget and slots, then the two ways to spend them */}
        <div className="card p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-6">
            <div>
              <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Budget</p>
              <p className="bid-amount-display text-2xl sm:text-3xl tabular-nums">
                ${remainingBudget}
              </p>
              {totalPendingBids > 0 && (
                <p className="text-foreground-muted text-xs mt-1 tabular-nums">
                  ${totalPendingBids} in active bids
                </p>
              )}
            </div>

            <div className="hidden sm:block h-14 w-px bg-border" />

            <SlotStat label="Roster" used={usedRosterSlots} total={rosterSlots} />

            {hasCounterpicks && (
              <>
                <div className="hidden sm:block h-14 w-px bg-border" />
                <SlotStat
                  label="Counterpicks"
                  used={biddingCounterpickCount}
                  total={biddingCounterpickSlots}
                />
              </>
            )}
          </div>

          <BidWeekTimeline cutoffAt={newBidCutoffAt} processingDeadline={processingDeadline} />

          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button
              onClick={() => openPlaceBid()}
              disabled={!canOpenBidModal}
              title={getBidCtaTitle(isCounterBidPhase, hasContestedBids)}
              className="btn btn-primary px-6 py-3 text-base w-full sm:w-auto"
              data-testid="place-bid-button"
            >
              {isCounterBidPhase ? <Swords className="w-5 h-5 mr-2" /> : <Plus className="w-5 h-5 mr-2" />}
              {isCounterBidPhase ? 'Counter a Bid' : 'Place Bid'}
            </button>

            {canPlaceCounterpickBid && (
              <button
                onClick={() => openCounterpickBid()}
                className="btn btn-secondary px-6 py-3 text-base w-full sm:w-auto border-crimson text-crimson hover:bg-crimson/10"
                data-testid="place-counterpick-bid-button"
              >
                <Target className="w-5 h-5 mr-2" />
                Place Counterpick Bid
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Bidding views">
            {TABS.map((tab) => {
              const isActive = activeSegment === tab.segment
              return (
                <Link
                  key={tab.label}
                  href={`/league/${league.id}/bidding${tab.segment ? `/${tab.segment}` : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  data-testid={`bidding-tab-${tab.label.toLowerCase()}`}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-gold border-gold'
                      : 'text-foreground-secondary hover:text-foreground border-transparent'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {children}
      </div>

      {isBidModalOpen && (
        <PlaceBidModal
          isOpen={isBidModalOpen}
          onClose={() => {
            setIsBidModalOpen(false)
            setCounterBidTarget(null)
          }}
          teamId={teamId}
          budget={budget}
          existingBids={bids}
          ownedTmdbIds={ownedTmdbIds}
          onPlaceBid={bidding.placeBid}
          myHoldings={droppableHoldings}
          freeRosterSlots={freeRosterSlots}
          counterBidTarget={counterBidTarget}
          isCounterBidPhase={isCounterBidPhase}
          newBidCutoffAt={newBidCutoffAt}
        />
      )}

      {isCounterpickModalOpen && (
        <PlaceCounterpickBidModal
          isOpen={isCounterpickModalOpen}
          onClose={() => {
            setIsCounterpickModalOpen(false)
            setCounterCounterpickTarget(null)
          }}
          leagueId={league.id}
          teamId={teamId}
          budget={budget}
          counterpickBids={counterpickBids}
          onPlaceCounterpickBid={bidding.placeCounterpickBid}
          counterTarget={counterCounterpickTarget}
        />
      )}
    </BiddingProvider>
  )
}
