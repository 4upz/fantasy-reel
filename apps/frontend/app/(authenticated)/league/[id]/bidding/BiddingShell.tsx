'use client'

import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Plus, Target } from 'lucide-react'
import type { CounterpickBid, League, PickupBid, TeamWithOwner } from '@/types'
import { useBidding } from '../hooks/useBidding'
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

interface Props {
  league: League
  teamId: string
  teams: TeamWithOwner[]
  ownedTmdbIds: number[]
  usedPickupSlots: number
  biddingCounterpickSlots: number
  children: React.ReactNode
}

export default function BiddingShell({
  league,
  teamId,
  teams,
  ownedTmdbIds,
  usedPickupSlots,
  biddingCounterpickSlots,
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
  const pickupSlots = league.total_slots - league.draft_slots
  const remainingBudget = budget?.remaining_budget ?? 100
  const canPlaceBid = usedPickupSlots < pickupSlots
  const canPlaceCounterpickBid = hasCounterpicks && biddingCounterpickCount < biddingCounterpickSlots

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
      usedPickupSlots,
      biddingCounterpickSlots,
      canPlaceBid,
      canPlaceCounterpickBid,
      openPlaceBid,
      openCounterpickBid,
    }),
    [
      league,
      teamId,
      teams,
      bidding,
      ownedTmdbIds,
      usedPickupSlots,
      biddingCounterpickSlots,
      canPlaceBid,
      canPlaceCounterpickBid,
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

            <SlotStat label="Pickups" used={usedPickupSlots} total={pickupSlots} />

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

          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button
              onClick={() => openPlaceBid()}
              disabled={!canPlaceBid}
              title={canPlaceBid ? undefined : 'All pickup slots are full — drop a movie to bid again'}
              className="btn btn-primary px-6 py-3 text-base w-full sm:w-auto"
              data-testid="place-bid-button"
            >
              <Plus className="w-5 h-5 mr-2" />
              Place Bid
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
          counterBidTarget={counterBidTarget}
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
