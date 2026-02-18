'use client'

import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { Plus, TrendingUp, AlertCircle, Film, Sparkles, Target, Clock, DollarSign, AlertTriangle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { League, PickupBid, TeamBudget, CounterpickBid } from '@/types'
import BidCard from './BidCard'
import { getTmdbPosterUrl } from './utils'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const PlaceBidModal = dynamic(() => import('./PlaceBidModal'), {
  loading: () => <div className="modal-overlay"><div className="animate-pulse h-[85vh] max-w-2xl w-full mx-4 bg-surface rounded-2xl" /></div>,
})

const PlaceCounterpickBidModal = dynamic(() => import('./PlaceCounterpickBidModal'), {
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

function formatTimeRemaining(deadline: string | null): string {
  if (!deadline) return 'Processing soon'

  const now = new Date()
  const end = new Date(deadline)
  const diff = end.getTime() - now.getTime()

  if (diff <= 0) return 'Processing soon'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

interface CounterpickBidCardProps {
  bid: CounterpickBid
  isOwner: boolean
  onCancel?: () => void
  onCounter?: () => void
}

function CounterpickBidCard({ bid, isOwner, onCancel, onCounter }: CounterpickBidCardProps) {
  const isOutbid = bid.status === 'outbid'
  const deadline = isOutbid ? bid.response_deadline : bid.processing_deadline
  const movieTitle = bid.movies?.title || 'Unknown Movie'
  const posterUrl = bid.movies?.poster_url || null

  return (
    <div
      className={`card bid-card-interactive p-4 ${
        isOutbid ? 'border-warning bg-warning-bg/20 outbid-pulse' : ''
      }`}
      data-testid={`counterpick-bid-card-${bid.movie_id}`}
    >
      <div className="flex gap-4">
        {/* Movie Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-elevated shadow-soft">
          {posterUrl ? (
            <Image
              src={getTmdbPosterUrl(posterUrl, 'w92')!}
              alt={movieTitle}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-6 h-6 text-foreground-muted" />
            </div>
          )}
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground truncate">
            {movieTitle}
          </h4>

          <p className="text-sm text-foreground-secondary mt-0.5 flex items-center gap-1">
            <Target className="w-3.5 h-3.5 text-crimson" />
            vs {bid.target_team?.name || 'Unknown Team'}
          </p>

          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 bid-amount-display text-lg">
              <DollarSign className="w-5 h-5" />
              <span>{bid.amount}</span>
            </div>

            <div className="flex items-center gap-1.5 text-foreground-secondary text-sm">
              <Clock className="w-4 h-4" />
              <span>{formatTimeRemaining(deadline)}</span>
            </div>
          </div>

          {isOutbid && (
            <div className="flex items-center gap-1.5 mt-2 text-warning text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />
              <span>You&apos;ve been outbid!</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {isOwner && (
          <div className="flex flex-col items-end gap-2">
            {isOutbid && onCounter && (
              <button
                onClick={onCounter}
                className="btn btn-primary text-sm px-4"
              >
                Counter Bid
              </button>
            )}

            {bid.status === 'active' && onCancel && (
              <button
                onClick={onCancel}
                className="btn btn-ghost text-sm text-crimson hover:text-crimson-hover hover:bg-crimson/10"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface CounterpickBidSectionProps {
  title: string
  icon: React.ReactNode
  titleClassName?: string
  bids: CounterpickBid[]
  isOwner: boolean
  onCancel?: (bidId: string) => void
  onCounter?: (bid: CounterpickBid) => void
  className?: string
}

function CounterpickBidSection({
  title,
  icon,
  titleClassName = 'text-foreground-secondary',
  bids,
  isOwner,
  onCancel,
  onCounter,
  className = '',
}: CounterpickBidSectionProps): React.ReactElement | null {
  if (bids.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        {icon}
        <h4 className={`text-sm font-medium ${titleClassName}`}>
          {title} ({bids.length})
        </h4>
      </div>
      <div className="space-y-3">
        {bids.map((bid, index) => (
          <div
            key={bid.id}
            className="animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <CounterpickBidCard
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
  biddingCounterpickCount: number
  biddingCounterpickSlots: number
  counterpickBids: CounterpickBid[]
  myCounterpickBids: CounterpickBid[]
  onPlaceCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  onCancelCounterpickBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
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
}: BiddingPanelProps): React.ReactElement {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [counterBidTarget, setCounterBidTarget] = useState<PickupBid | null>(null)
  const [isCounterpickBidModalOpen, setIsCounterpickBidModalOpen] = useState(false)
  const [counterCounterpickBidTarget, setCounterCounterpickBidTarget] = useState<CounterpickBid | null>(null)

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

  return (
    <div className="space-y-6" data-testid="bidding-panel">
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
            data-testid="place-bid-button"
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

      {/* Counterpick Bids Section */}
      {biddingCounterpickSlots > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-crimson/10 rounded-lg">
              <Target className="w-5 h-5 text-crimson" />
            </div>
            <h3 className="font-display font-semibold text-foreground">Counterpick Bids</h3>
            <span className="text-foreground-muted text-sm">
              ({biddingCounterpickCount}/{biddingCounterpickSlots} won)
            </span>
          </div>

          <CounterpickBidSection
            title="Outbid"
            icon={<div className="p-1 bg-warning-bg rounded"><AlertCircle className="w-4 h-4 text-warning" /></div>}
            titleClassName="text-warning"
            bids={outbidCounterpickBids}
            isOwner={true}
            onCancel={handleCancelCounterpickBid}
            onCounter={handleCounterCounterpickBid}
            className="animate-fade-in"
          />

          <CounterpickBidSection
            title="My Active Counterpick Bids"
            icon={<div className="p-1 bg-crimson/10 rounded"><Target className="w-4 h-4 text-crimson" /></div>}
            bids={activeCounterpickBids}
            isOwner={true}
            onCancel={handleCancelCounterpickBid}
          />

          <CounterpickBidSection
            title="Other Counterpick Bids"
            icon={<div className="p-1 bg-elevated rounded"><TrendingUp className="w-4 h-4 text-foreground-secondary" /></div>}
            bids={otherCounterpickBids}
            isOwner={false}
          />

          {/* Place Counterpick Bid button */}
          {biddingCounterpickCount < biddingCounterpickSlots ? (
            <div className="card p-4">
              <p className="text-foreground-secondary text-sm mb-3">
                Bet against opponent movies to earn bonus points. Compete with other teams for counterpick slots.
              </p>
              <button
                onClick={() => setIsCounterpickBidModalOpen(true)}
                className="btn btn-secondary flex items-center gap-2"
              >
                <Target className="w-4 h-4" />
                Place Counterpick Bid
              </button>
            </div>
          ) : (
            <div className="card p-4">
              <p className="text-foreground-muted text-sm">
                All counterpick slots won.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {myBids.length === 0 && otherBids.length === 0 && myCounterpickBids.length === 0 && otherCounterpickBids.length === 0 && (
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

      {/* Place Counterpick Bid Modal */}
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
    </div>
  )
}
