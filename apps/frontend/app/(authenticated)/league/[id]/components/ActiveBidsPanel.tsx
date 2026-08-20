'use client'

import { useCallback, useMemo } from 'react'
import { AlertCircle, Film, Plus, Sparkles, Target, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { CounterpickBid, PickupBid } from '@/types'
import BidCard from './BidCard'
import CounterpickBidCard from './CounterpickBidCard'
import BidPriorityList from './BidPriorityList'
import CounterpickPriorityList from './CounterpickPriorityList'
import { groupBy, isMovieBiddable, latestOpenCounterWindow } from './utils'
import { useBiddingContext } from '../bidding/BiddingContext'

type UnifiedBidItem =
  | { type: 'pickup'; bid: PickupBid }
  | { type: 'counterpick'; bid: CounterpickBid }

/** Pickup and counterpick bids share the sections, so they share a list shape. */
function toUnifiedItems(
  pickupBids: PickupBid[],
  counterpickBids: CounterpickBid[],
): UnifiedBidItem[] {
  return [
    ...pickupBids.map((bid) => ({ type: 'pickup' as const, bid })),
    ...counterpickBids.map((bid) => ({ type: 'counterpick' as const, bid })),
  ]
}

/**
 * Movies whose processing is held past the weekly deadline because a rival's
 * counter window is still open, keyed by movie and mapped to when that window
 * closes. Must be given the whole league's bids: the open window lives on the
 * *outbid* row, not on the leading bid whose card needs to explain the delay.
 */
function counterWindowsByMovie<K, B extends { response_deadline: string | null }>(
  bids: B[],
  movieKeyOf: (bid: B) => K,
): Map<K, string> {
  const windows = new Map<K, string>()
  for (const [key, group] of groupBy(bids, movieKeyOf)) {
    const closesAt = latestOpenCounterWindow(group)
    if (closesAt) windows.set(key, closesAt)
  }
  return windows
}

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

export default function ActiveBidsPanel(): React.ReactElement {
  const {
    league,
    teamId,
    bidding,
    usedRosterSlots,
    myHoldings,
    biddingCounterpickSlots,
    canPlaceCounterpickBid,
    isCounterBidPhase,
    canOpenBidModal,
    openPlaceBid,
    openCounterpickBid,
  } = useBiddingContext()

  const {
    bids,
    myBids,
    counterpickBids,
    myCounterpickBids,
    biddingCounterpickCount,
    cancelBid,
    cancelCounterpickBid,
    setBidPriorities,
    setCounterpickBidPriorities,
  } = bidding

  /** Holding id -> title, so a bid can name the movie it would drop. */
  const holdingTitles = useMemo(
    () => new Map(myHoldings.map((holding) => [holding.holding_id, holding.title])),
    [myHoldings]
  )

  const hasCounterpicks = biddingCounterpickSlots > 0

  const handleCancelBid = useCallback(async (bidId: string) => {
    const { success, error } = await cancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }, [cancelBid])

  const handleCancelCounterpickBid = useCallback(async (bidId: string) => {
    const { success, error } = await cancelCounterpickBid(bidId)
    if (success) {
      toast.success('Counterpick bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel counterpick bid')
    }
  }, [cancelCounterpickBid])

  const { actionRequiredItems, myActiveItems, competingItems } = useMemo(() => ({
    actionRequiredItems: toUnifiedItems(
      myBids.filter((bid) => bid.status === 'outbid'),
      myCounterpickBids.filter((bid) => bid.status === 'outbid'),
    ),
    myActiveItems: toUnifiedItems(
      myBids.filter((bid) => bid.status === 'active'),
      myCounterpickBids.filter((bid) => bid.status === 'active'),
    ),
    competingItems: toUnifiedItems(
      bids.filter((bid) => bid.team_id !== teamId && bid.status === 'active'),
      counterpickBids.filter((bid) => bid.team_id !== teamId && bid.status === 'active'),
    ),
  }), [myBids, myCounterpickBids, bids, counterpickBids, teamId])

  const hasAnyBids =
    myBids.length > 0 || myCounterpickBids.length > 0 || competingItems.length > 0

  const pickupCounterWindows = useMemo(
    () => counterWindowsByMovie(bids, (bid) => bid.tmdb_id),
    [bids]
  )

  const counterpickCounterWindows = useMemo(
    () => counterWindowsByMovie(counterpickBids, (bid) => bid.movie_id),
    [counterpickBids]
  )

  function renderBidItem(item: UnifiedBidItem, isOwner: boolean): React.ReactElement {
    // A released movie can't be bid on any more, so offering "Counter Bid" on
    // one is a dead end -- the server rejects it once the modal is filled in.
    const releaseDate = item.type === 'pickup'
      ? item.bid.movie_data?.release_date ?? null
      : item.bid.movies?.release_date ?? null
    const canCounter = isMovieBiddable(releaseDate)

    if (item.type === 'pickup') {
      // Only the bid's own team holds the drop target, so only they can be
      // shown its title -- another team's roster is not this card's business.
      const dropHoldingId =
        item.bid.conditional_drop_pickup_id ?? item.bid.conditional_drop_draft_pick_id
      const dropTitle = isOwner && dropHoldingId
        ? holdingTitles.get(dropHoldingId) ?? null
        : null

      return (
        <BidCard
          bid={item.bid}
          isOwner={isOwner}
          bidType="pickup"
          dropTitle={dropTitle}
          onCancel={isOwner && !isCounterBidPhase ? () => handleCancelBid(item.bid.id) : undefined}
          cancelLocked={isOwner && isCounterBidPhase}
          onCounter={canCounter ? () => openPlaceBid(item.bid) : undefined}
          counterWindowClosesAt={pickupCounterWindows.get(item.bid.tmdb_id) ?? null}
        />
      )
    }
    return (
      <CounterpickBidCard
        bid={item.bid}
        isOwner={isOwner}
        bidType="counterpick"
        onCancel={isOwner && !isCounterBidPhase ? () => handleCancelCounterpickBid(item.bid.id) : undefined}
        cancelLocked={isOwner && isCounterBidPhase}
        onCounter={canCounter ? () => openCounterpickBid(item.bid) : undefined}
        counterWindowClosesAt={counterpickCounterWindows.get(item.bid.movie_id) ?? null}
      />
    )
  }

  // Cards stagger in rather than appearing at once, so a long list reads as one
  // arriving group instead of a flash.
  function renderBidList(items: UnifiedBidItem[], isOwner: boolean): React.ReactElement[] {
    return items.map((item, index) => (
      <div
        key={`${item.type}-${item.bid.id}`}
        className="animate-slide-up"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        {renderBidItem(item, isOwner)}
      </div>
    ))
  }

  return (
    <div className="space-y-6" data-testid="active-bids-panel">
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
          {renderBidList(actionRequiredItems, true)}
        </UnifiedBidSection>
      )}

      {/* Bid priority: which pickups the team keeps if more of its bids win than
          it has roster room for. Deliberately separate from the counterpick list
          below -- the two draw on different capacity pools, so ranking them
          against each other would mean nothing. */}
      <BidPriorityList
        bids={myBids}
        slots={league.total_slots}
        used={usedRosterSlots}
        onReorder={setBidPriorities}
      />

      {/* Counterpick priority: which counterpicks the team keeps if more of its
          bids win than it has slots for. Only meaningful once counterpicks are
          enabled and more than one bid is pending. */}
      {hasCounterpicks && (
        <CounterpickPriorityList
          bids={myCounterpickBids}
          slots={biddingCounterpickSlots}
          used={biddingCounterpickCount}
          onReorder={setCounterpickBidPriorities}
        />
      )}

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
          {renderBidList(myActiveItems, true)}
        </UnifiedBidSection>
      )}

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
          {renderBidList(competingItems, false)}
        </UnifiedBidSection>
      )}

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
              onClick={() => openPlaceBid()}
              disabled={!canOpenBidModal}
              className="btn btn-primary px-6 py-3"
            >
              <Plus className="w-5 h-5 mr-2" />
              Place Your First Bid
            </button>
            {canPlaceCounterpickBid && (
              <button
                onClick={() => openCounterpickBid()}
                className="btn btn-secondary px-6 py-3 border-crimson text-crimson hover:bg-crimson/10"
              >
                <Target className="w-5 h-5 mr-2" />
                Place Counterpick Bid
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
