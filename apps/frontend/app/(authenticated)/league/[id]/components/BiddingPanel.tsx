'use client'

import { useState } from 'react'
import { DollarSign, Plus, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { League, PickupBid, TeamBudget } from '@/types'
import BidCard from './BidCard'
import PlaceBidModal from './PlaceBidModal'

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

  const handleCancelBid = async (bidId: string) => {
    const { success, error } = await onCancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }

  const handleCounter = (bid: PickupBid) => {
    setCounterBidTarget(bid)
    setIsModalOpen(true)
  }

  // Separate outbid (urgent) from active bids
  const outbidBids = myBids.filter(b => b.status === 'outbid')
  const activeBids = myBids.filter(b => b.status === 'active')

  // Other teams' active bids (for visibility)
  const otherBids = bids.filter(b => b.team_id !== teamId && b.status === 'active')

  return (
    <div className="space-y-6">
      {/* Budget & Slots Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-foreground-muted text-sm">Budget</p>
              <p className="font-display font-semibold text-2xl text-gold">
                ${budget?.remaining_budget ?? 100}
              </p>
            </div>
            <div className="h-10 w-px bg-border" />
            <div>
              <p className="text-foreground-muted text-sm">Pickup Slots</p>
              <p className="font-display font-semibold text-xl text-foreground">
                {usedPickupSlots}/{pickupSlots}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            disabled={availableSlots <= 0}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Place Bid
          </button>
        </div>
      </div>

      {/* Outbid Warning */}
      {outbidBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-warning" />
            Action Required ({outbidBids.length})
          </h3>
          {outbidBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={true}
              onCancel={() => handleCancelBid(bid.id)}
              onCounter={() => handleCounter(bid)}
            />
          ))}
        </div>
      )}

      {/* My Active Bids */}
      {activeBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gold" />
            My Active Bids ({activeBids.length})
          </h3>
          {activeBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={true}
              onCancel={() => handleCancelBid(bid.id)}
            />
          ))}
        </div>
      )}

      {/* Other Bids */}
      {otherBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground-secondary">
            Other Active Bids ({otherBids.length})
          </h3>
          {otherBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={false}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {myBids.length === 0 && otherBids.length === 0 && (
        <div className="card p-8 text-center">
          <DollarSign className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
          <h3 className="font-display font-semibold text-foreground mb-2">
            No Active Bids
          </h3>
          <p className="text-foreground-secondary mb-4">
            Place a bid on upcoming movies to add them to your roster.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
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
      />
    </div>
  )
}
