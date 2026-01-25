'use client'

import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Plus, TrendingUp, AlertCircle, Film, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { League, PickupBid, TeamBudget } from '@/types'
import BidCard from './BidCard'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const PlaceBidModal = dynamic(() => import('./PlaceBidModal'), {
  loading: () => <div className="modal-overlay"><div className="animate-pulse h-[85vh] max-w-2xl w-full mx-4 bg-surface rounded-2xl" /></div>,
})

interface BidSectionProps {
  title: string
  icon: React.ReactNode
  count: number
  bids: PickupBid[]
  isOwner: boolean
  onCancel?: (bidId: string) => void
  onCounter?: (bid: PickupBid) => void
  titleClassName?: string
}

function BidSection({
  title,
  icon,
  count,
  bids,
  isOwner,
  onCancel,
  onCounter,
  titleClassName = 'text-foreground',
}: BidSectionProps): React.ReactElement {
  return (
    <div className="space-y-3">
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
        {bids.map((bid, index) => (
          <div
            key={bid.id}
            className="animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <BidCard
              bid={bid}
              isOwner={isOwner}
              onCancel={onCancel ? () => onCancel(bid.id) : undefined}
              onCounter={onCounter ? () => onCounter(bid) : undefined}
            />
          </div>
        ))}
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
}: BiddingPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [counterBidTarget, setCounterBidTarget] = useState<PickupBid | null>(null)

  const pickupSlots = league.total_slots - league.draft_slots
  const usedPickupSlots = 0 // TODO: Get from pickups query
  const availableSlots = pickupSlots - usedPickupSlots
  const remainingBudget = budget?.remaining_budget ?? 100

  // Memoize to prevent re-renders (rerender-memo optimization)
  const handleCancelBid = useCallback(async (bidId: string) => {
    const { success, error } = await onCancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }, [onCancelBid])

  // Memoize to prevent re-renders (rerender-memo optimization)
  const handleCounter = useCallback((bid: PickupBid) => {
    setCounterBidTarget(bid)
    setIsModalOpen(true)
  }, [])

  // Memoize to prevent re-renders (rerender-memo optimization)
  const { outbidBids, activeBids, otherBids, totalPendingBids } = useMemo(() => {
    const outbid = myBids.filter(b => b.status === 'outbid')
    const active = myBids.filter(b => b.status === 'active')
    const other = bids.filter(b => b.team_id !== teamId && b.status === 'active')
    const totalPending = active.reduce((sum, b) => sum + b.amount, 0) +
      outbid.reduce((sum, b) => sum + b.amount, 0)
    return { outbidBids: outbid, activeBids: active, otherBids: other, totalPendingBids: totalPending }
  }, [myBids, bids, teamId])

  return (
    <div className="space-y-6">
      {/* Budget & Slots Header Card */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Stats */}
          <div className="flex items-center gap-6">
            {/* Budget */}
            <div>
              <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Budget</p>
              <p className="bid-amount-display text-3xl">
                ${remainingBudget}
              </p>
              {totalPendingBids > 0 && (
                <p className="text-foreground-muted text-xs mt-1">
                  ${totalPendingBids} in active bids
                </p>
              )}
            </div>

            <div className="h-14 w-px bg-border" />

            {/* Pickup Slots */}
            <div>
              <p className="text-foreground-muted text-xs uppercase tracking-wide mb-1">Pickup Slots</p>
              <div className="flex items-baseline gap-1">
                <span className="font-display font-bold text-3xl text-foreground">
                  {usedPickupSlots}
                </span>
                <span className="text-foreground-muted text-lg">/ {pickupSlots}</span>
              </div>
              <p className="text-foreground-muted text-xs mt-1">
                {availableSlots} available
              </p>
            </div>
          </div>

          {/* Place Bid Button */}
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={availableSlots <= 0}
            className="btn btn-primary px-6 py-3 text-base"
          >
            <Plus className="w-5 h-5 mr-2" />
            Place Bid
          </button>
        </div>
      </div>

      {/* Outbid Warning Section */}
      {outbidBids.length > 0 && (
        <div className="animate-fade-in">
          <BidSection
            title="Action Required"
            icon={
              <div className="p-1.5 bg-warning-bg rounded-lg">
                <AlertCircle className="w-5 h-5 text-warning" />
              </div>
            }
            count={outbidBids.length}
            bids={outbidBids}
            isOwner={true}
            onCancel={handleCancelBid}
            onCounter={handleCounter}
          />
        </div>
      )}

      {/* My Active Bids Section */}
      {activeBids.length > 0 && (
        <BidSection
          title="My Active Bids"
          icon={
            <div className="p-1.5 bg-gold-muted rounded-lg">
              <Sparkles className="w-5 h-5 text-gold" />
            </div>
          }
          count={activeBids.length}
          bids={activeBids}
          isOwner={true}
          onCancel={handleCancelBid}
        />
      )}

      {/* Other Bids Section */}
      {otherBids.length > 0 && (
        <BidSection
          title="Other Active Bids"
          icon={
            <div className="p-1.5 bg-elevated rounded-lg">
              <TrendingUp className="w-5 h-5 text-foreground-secondary" />
            </div>
          }
          count={otherBids.length}
          bids={otherBids}
          isOwner={false}
          titleClassName="text-foreground-secondary"
        />
      )}

      {/* Empty State */}
      {myBids.length === 0 && otherBids.length === 0 && (
        <div className="card p-10 text-center animate-fade-in">
          <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Film className="w-8 h-8 text-foreground-muted" />
          </div>
          <h3 className="font-display font-bold text-xl text-foreground mb-2">
            No Active Bids
          </h3>
          <p className="text-foreground-secondary mb-6 max-w-md mx-auto">
            Place a bid on upcoming movies to add them to your roster.
            Movies are awarded to the highest bidder when bidding closes.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary px-6 py-3"
          >
            <Plus className="w-5 h-5 mr-2" />
            Place Your First Bid
          </button>
        </div>
      )}

      {/* Place Bid Modal */}
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
    </div>
  )
}
