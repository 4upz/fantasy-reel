'use client'

import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Plus, TrendingUp, AlertCircle, Film, Sparkles, Target } from 'lucide-react'
import { toast } from 'sonner'
import type { League, PickupBid, TeamBudget, CounterpickBid } from '@/types'
import BidCard from './BidCard'
import CounterpickBidCard from './CounterpickBidCard'
import CounterpickPriorityList from './CounterpickPriorityList'

function ModalLoadingFallback(): React.ReactElement {
  return (
    <div className="modal-overlay">
      <div className="animate-pulse h-[85vh] max-w-2xl w-full mx-4 bg-surface rounded-2xl" />
    </div>
  )
}

const PlaceBidModal = dynamic(() => import('./PlaceBidModal'), {
  loading: ModalLoadingFallback,
})

const PlaceCounterpickBidModal = dynamic(() => import('./PlaceCounterpickBidModal'), {
  loading: ModalLoadingFallback,
})

type UnifiedBidItem =
  | { type: 'pickup'; bid: PickupBid }
  | { type: 'counterpick'; bid: CounterpickBid }

interface UnifiedBidSectionProps {
  title: string
  icon: React.ReactNode
  count: number
  titleClassName?: string
  className?: string
  children: React.ReactNode
}

function UnifiedBidSection({
  title,
  icon,
  count,
  titleClassName = 'text-foreground',
  className = '',
  children,
}: UnifiedBidSectionProps): React.ReactElement {
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className={`font-display font-semibold ${titleClassName}`}>
          {title}
        </h3>
        <span className="text-foreground-muted text-sm">
          ({count})
        </span>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

interface BiddingPanelProps {
  league: League
  teamId: string
  bids: PickupBid[]
  myBids: PickupBid[]
  budget: TeamBudget | null
  draftedTmdbIds: number[]
  onPlaceBid: (tmdbId: number, amount: number, movieData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  onCancelBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  biddingCounterpickCount: number
  biddingCounterpickSlots: number
  counterpickBids: CounterpickBid[]
  myCounterpickBids: CounterpickBid[]
  onPlaceCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  onCancelCounterpickBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  onReorderCounterpickBids: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

export default function BiddingPanel({
  league,
  teamId,
  bids,
  myBids,
  budget,
  draftedTmdbIds,
  onPlaceBid,
  onCancelBid,
  biddingCounterpickCount,
  biddingCounterpickSlots,
  counterpickBids,
  myCounterpickBids,
  onPlaceCounterpickBid,
  onCancelCounterpickBid,
  onReorderCounterpickBids,
}: BiddingPanelProps): React.ReactElement {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [counterBidTarget, setCounterBidTarget] = useState<PickupBid | null>(null)
  const [isCounterpickBidModalOpen, setIsCounterpickBidModalOpen] = useState(false)
  const [counterCounterpickBidTarget, setCounterCounterpickBidTarget] = useState<CounterpickBid | null>(null)

  const hasCounterpicks = biddingCounterpickSlots > 0

  const pickupSlots = league.total_slots - league.draft_slots
  const usedPickupSlots = 0 // TODO: Get from pickups query
  const availableSlots = pickupSlots - usedPickupSlots
  const remainingBudget = budget?.remaining_budget ?? 100

  const handleCancelBid = useCallback(async (bidId: string) => {
    const { success, error } = await onCancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }, [onCancelBid])

  const handleCounter = useCallback((bid: PickupBid) => {
    setCounterBidTarget(bid)
    setIsModalOpen(true)
  }, [])

  const handleCancelCounterpickBid = useCallback(async (bidId: string) => {
    const { success, error } = await onCancelCounterpickBid(bidId)
    if (success) {
      toast.success('Counterpick bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel counterpick bid')
    }
  }, [onCancelCounterpickBid])

  const handleCounterCounterpickBid = useCallback((bid: CounterpickBid) => {
    setCounterCounterpickBidTarget(bid)
    setIsCounterpickBidModalOpen(true)
  }, [])

  const { outbidBids, activeBids, otherBids, totalPendingBids } = useMemo(() => {
    const outbid = myBids.filter(b => b.status === 'outbid')
    const active = myBids.filter(b => b.status === 'active')
    const other = bids.filter(b => b.team_id !== teamId && b.status === 'active')
    const totalPending = active.reduce((sum, b) => sum + b.amount, 0) +
      outbid.reduce((sum, b) => sum + b.amount, 0)
    return { outbidBids: outbid, activeBids: active, otherBids: other, totalPendingBids: totalPending }
  }, [myBids, bids, teamId])

  const { outbidCounterpickBids, activeCounterpickBids, otherCounterpickBids } = useMemo(() => {
    const outbid = myCounterpickBids.filter(b => b.status === 'outbid')
    const active = myCounterpickBids.filter(b => b.status === 'active')
    const other = counterpickBids.filter(b => b.team_id !== teamId && b.status === 'active')
    return { outbidCounterpickBids: outbid, activeCounterpickBids: active, otherCounterpickBids: other }
  }, [myCounterpickBids, counterpickBids, teamId])

  // Unified bid item arrays for merged sections
  const actionRequiredItems: UnifiedBidItem[] = useMemo(() => [
    ...outbidBids.map(bid => ({ type: 'pickup' as const, bid })),
    ...outbidCounterpickBids.map(bid => ({ type: 'counterpick' as const, bid })),
  ], [outbidBids, outbidCounterpickBids])

  const myActiveItems: UnifiedBidItem[] = useMemo(() => [
    ...activeBids.map(bid => ({ type: 'pickup' as const, bid })),
    ...activeCounterpickBids.map(bid => ({ type: 'counterpick' as const, bid })),
  ], [activeBids, activeCounterpickBids])

  const competingItems: UnifiedBidItem[] = useMemo(() => [
    ...otherBids.map(bid => ({ type: 'pickup' as const, bid })),
    ...otherCounterpickBids.map(bid => ({ type: 'counterpick' as const, bid })),
  ], [otherBids, otherCounterpickBids])

  const hasAnyBids = myBids.length > 0 || otherBids.length > 0 || myCounterpickBids.length > 0 || otherCounterpickBids.length > 0

  function renderBidItem(
    item: UnifiedBidItem,
    isOwner: boolean,
    options?: { showCounter?: boolean },
  ): React.ReactElement {
    if (item.type === 'pickup') {
      return (
        <BidCard
          bid={item.bid}
          isOwner={isOwner}
          bidType="pickup"
          onCancel={isOwner ? () => handleCancelBid(item.bid.id) : undefined}
          onCounter={options?.showCounter ? () => handleCounter(item.bid) : undefined}
        />
      )
    }
    return (
      <CounterpickBidCard
        bid={item.bid}
        isOwner={isOwner}
        bidType="counterpick"
        onCancel={isOwner ? () => handleCancelCounterpickBid(item.bid.id) : undefined}
        onCounter={options?.showCounter ? () => handleCounterCounterpickBid(item.bid) : undefined}
      />
    )
  }

  return (
    <div className="space-y-6" data-testid="bidding-panel">
      {/* Unified Header Card */}
      <div className="card p-4 sm:p-5">
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-6">
          {/* Budget */}
          <div>
            <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Budget</p>
            <p className="bid-amount-display text-2xl sm:text-3xl">
              ${remainingBudget}
            </p>
            {totalPendingBids > 0 && (
              <p className="text-foreground-muted text-xs mt-1">
                ${totalPendingBids} in active bids
              </p>
            )}
          </div>

          <div className="hidden sm:block h-14 w-px bg-border" />

          {/* Pickup Slots */}
          <div>
            <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Pickups</p>
            <div className="flex items-baseline gap-1">
              <span className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                {usedPickupSlots}
              </span>
              <span className="text-foreground-muted text-base sm:text-lg">/ {pickupSlots}</span>
            </div>
          </div>

          {/* Counterpick Slots */}
          {hasCounterpicks && (
            <>
              <div className="hidden sm:block h-14 w-px bg-border" />
              <div>
                <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Counterpicks</p>
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                    {biddingCounterpickCount}
                  </span>
                  <span className="text-foreground-muted text-base sm:text-lg">/ {biddingCounterpickSlots}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={availableSlots <= 0}
            className="btn btn-primary px-6 py-3 text-base w-full sm:w-auto"
            data-testid="place-bid-button"
          >
            <Plus className="w-5 h-5 mr-2" />
            Place Bid
          </button>

          {hasCounterpicks && biddingCounterpickCount < biddingCounterpickSlots && (
            <button
              onClick={() => setIsCounterpickBidModalOpen(true)}
              className="btn btn-secondary px-6 py-3 text-base w-full sm:w-auto border-crimson text-crimson hover:bg-crimson/10"
              data-testid="place-counterpick-bid-button"
            >
              <Target className="w-5 h-5 mr-2" />
              Place Counterpick Bid
            </button>
          )}
        </div>
      </div>

      {/* Action Required Section (unified outbid bids) */}
      {actionRequiredItems.length > 0 && (
        <UnifiedBidSection
          title="Action Required"
          icon={
            <div className="p-1.5 bg-warning-bg rounded-lg">
              <AlertCircle className="w-5 h-5 text-warning" />
            </div>
          }
          count={actionRequiredItems.length}
          className="animate-fade-in"
        >
          {actionRequiredItems.map((item, index) => (
            <div
              key={`${item.type}-${item.bid.id}`}
              className="animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {renderBidItem(item, true, { showCounter: true })}
            </div>
          ))}
        </UnifiedBidSection>
      )}

      {/* Counterpick priority: which counterpicks the team keeps if more of its
          bids win than it has slots for. Only meaningful once counterpicks are
          enabled and more than one bid is pending. */}
      {hasCounterpicks && (
        <CounterpickPriorityList
          bids={myCounterpickBids}
          slots={biddingCounterpickSlots}
          used={biddingCounterpickCount}
          onReorder={onReorderCounterpickBids}
        />
      )}

      {/* My Active Bids Section (unified) */}
      {myActiveItems.length > 0 && (
        <UnifiedBidSection
          title="My Active Bids"
          icon={
            <div className="p-1.5 bg-gold-muted rounded-lg">
              <Sparkles className="w-5 h-5 text-gold" />
            </div>
          }
          count={myActiveItems.length}
        >
          {myActiveItems.map((item, index) => (
            <div
              key={`${item.type}-${item.bid.id}`}
              className="animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {renderBidItem(item, true)}
            </div>
          ))}
        </UnifiedBidSection>
      )}

      {/* Competing Bids Section (unified) */}
      {competingItems.length > 0 && (
        <UnifiedBidSection
          title="Competing Bids"
          icon={
            <div className="p-1.5 bg-elevated rounded-lg">
              <TrendingUp className="w-5 h-5 text-foreground-secondary" />
            </div>
          }
          count={competingItems.length}
          titleClassName="text-foreground-secondary"
        >
          {competingItems.map((item, index) => (
            <div
              key={`${item.type}-${item.bid.id}`}
              className="animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {renderBidItem(item, false)}
            </div>
          ))}
        </UnifiedBidSection>
      )}

      {/* Empty State */}
      {!hasAnyBids && (
        <div className="card p-10 text-center animate-fade-in">
          <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Film className="w-8 h-8 text-foreground-muted" />
          </div>
          <h3 className="font-display font-bold text-xl text-foreground mb-2">
            No Active Bids
          </h3>
          <p className="text-foreground-secondary mb-6 max-w-md mx-auto">
            Place a bid on upcoming movies to add them to your roster.
            {hasCounterpicks
              ? ' Or place a counterpick bid to bet against opponent movies.'
              : ' Movies are awarded to the highest bidder when bidding closes.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn btn-primary px-6 py-3"
            >
              <Plus className="w-5 h-5 mr-2" />
              Place Your First Bid
            </button>
            {hasCounterpicks && biddingCounterpickCount < biddingCounterpickSlots && (
              <button
                onClick={() => setIsCounterpickBidModalOpen(true)}
                className="btn btn-secondary px-6 py-3 border-crimson text-crimson hover:bg-crimson/10"
              >
                <Target className="w-5 h-5 mr-2" />
                Place Counterpick Bid
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modals - conditional rendering for code splitting */}
      {isModalOpen && (
        <PlaceBidModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false)
            setCounterBidTarget(null)
          }}
          budget={budget}
          existingBids={bids}
          draftedTmdbIds={draftedTmdbIds}
          onPlaceBid={onPlaceBid}
          counterBidTarget={counterBidTarget}
        />
      )}

      {isCounterpickBidModalOpen && (
        <PlaceCounterpickBidModal
          isOpen={isCounterpickBidModalOpen}
          onClose={() => {
            setIsCounterpickBidModalOpen(false)
            setCounterCounterpickBidTarget(null)
          }}
          leagueId={league.id}
          teamId={teamId}
          budget={budget}
          counterpickBids={counterpickBids}
          onPlaceCounterpickBid={onPlaceCounterpickBid}
          counterTarget={counterCounterpickBidTarget}
        />
      )}
    </div>
  )
}
