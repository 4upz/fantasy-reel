'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AlertCircle, Film, ListOrdered, Plus, Sparkles, Target, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { CounterpickBid, PickupBid } from '@/types'
import BidCard from './BidCard'
import CounterpickBidCard from './CounterpickBidCard'
import BiddingModalLoading from '../bidding/BiddingModalLoading'
import { groupBy, isMovieBiddable, latestOpenCounterWindow } from './utils'
import { useBiddingContext } from '../bidding/BiddingContext'
import { isScoreLocked } from '@/utils/scoring'

const BidPriorityModal = dynamic(() => import('./BidPriorityModal'), {
  loading: BiddingModalLoading,
})

type UnifiedBidItem =
  | { type: 'pickup'; bid: PickupBid }
  | { type: 'counterpick'; bid: CounterpickBid }

/** Which section a bid card sits in, so focus can land back on its heading. */
type SectionKey = 'action-required' | 'my-active' | 'competing' | 'empty'

/** Identifies a bid's card across both bid types, whichever section it is in. */
function bidKeyOf(type: UnifiedBidItem['type'], bidId: string): string {
  return `${type}-${bidId}`
}

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
  sectionKey: SectionKey
  title: string
  icon: React.ReactNode
  count: number
  titleClassName?: string
  className?: string
  children: React.ReactNode
  action?: React.ReactNode
}

function UnifiedBidSection({
  sectionKey,
  title,
  icon,
  count,
  titleClassName = 'text-foreground',
  className = '',
  children,
  action,
}: UnifiedBidSectionProps): React.ReactElement {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        {/* The count sits inside the heading so heading navigation reads it. */}
        <h3
          id={headingId}
          tabIndex={-1}
          data-section-heading={sectionKey}
          className={`type-panel focus:outline-none ${titleClassName}`}
        >
          {title}{' '}
          <span className="type-body-sm ml-1 text-foreground-secondary">({count})</span>
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {/* role="list" because list-style:none drops list semantics in Safari. */}
      <ul role="list" className="space-y-3">
        {children}
      </ul>
    </section>
  )
}

export default function ActiveBidsPanel(): React.ReactElement {
  const {
    teamId,
    bidding,
    myHoldings,
    scoredTmdbIds,
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
    cancelBid,
    cancelCounterpickBid,
  } = bidding

  const [isPriorityModalOpen, setIsPriorityModalOpen] = useState(false)
  // A toast shown while the dialog is open is hidden from screen readers along
  // with the rest of the page, so the save confirmation waits for it to close.
  const priorityToast = useRef<string | null>(null)
  const closePriorityModal = useCallback((successMessage?: string) => {
    priorityToast.current = successMessage ?? null
    setIsPriorityModalOpen(false)
  }, [])
  useEffect(() => {
    if (isPriorityModalOpen || !priorityToast.current) return
    toast.success(priorityToast.current)
    priorityToast.current = null
  }, [isPriorityModalOpen])

  const canEditPriority = myBids.length > 1 ||
    (biddingCounterpickSlots > 0 && myCounterpickBids.length > 1)

  /** Holding id -> title, so a bid can name the movie it would drop. */
  const holdingTitles = useMemo(
    () => new Map(myHoldings.map((holding) => [holding.holding_id, holding.title])),
    [myHoldings]
  )

  const hasCounterpicks = biddingCounterpickSlots > 0

  // A cancelled bid's card leaves the list, taking focus with it. Land it on
  // the heading of the section the card was in (or whatever section is left)
  // rather than dropping the user back at the top of the page.
  const panelRef = useRef<HTMLDivElement>(null)
  const focusAfterCancel = useRef<{ section: SectionKey; bidKey: string } | null>(null)
  const restoreFocusAfterCancel = useCallback(() => {
    const pending = focusAfterCancel.current
    const panel = panelRef.current
    if (!pending || !panel) return
    const active = document.activeElement
    const focusIsLost = !active || active === document.body
    const card = panel.querySelector(`[data-bid-key="${pending.bidKey}"]`)
    if (card) {
      // The card has not left yet. Wait for it while focus is still on it;
      // anywhere else, the user has moved on and focus is theirs.
      if (!focusIsLost && !card.contains(active)) focusAfterCancel.current = null
      return
    }
    // The card is gone, so this is the only attempt: a later bid update must
    // never pull focus back here.
    focusAfterCancel.current = null
    if (!focusIsLost) return
    const heading = panel.querySelector<HTMLElement>(`[data-section-heading="${pending.section}"]`)
      ?? panel.querySelector<HTMLElement>('[data-section-heading]')
    heading?.focus()
  }, [])
  useEffect(restoreFocusAfterCancel, [myBids, myCounterpickBids, restoreFocusAfterCancel])

  const afterCancel = useCallback((section: SectionKey, bidKey: string) => {
    focusAfterCancel.current = { section, bidKey }
    requestAnimationFrame(restoreFocusAfterCancel)
  }, [restoreFocusAfterCancel])

  const handleCancelBid = useCallback(async (bidId: string, section: SectionKey) => {
    const { success, error } = await cancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
      afterCancel(section, bidKeyOf('pickup', bidId))
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }, [cancelBid, afterCancel])

  const handleCancelCounterpickBid = useCallback(async (bidId: string, section: SectionKey) => {
    const { success, error } = await cancelCounterpickBid(bidId)
    if (success) {
      toast.success('Counterpick bid cancelled')
      afterCancel(section, bidKeyOf('counterpick', bidId))
    } else {
      toast.error(error || 'Failed to cancel counterpick bid')
    }
  }, [cancelCounterpickBid, afterCancel])

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

  function renderBidItem(item: UnifiedBidItem, isOwner: boolean, section: SectionKey): React.ReactElement {
    // A released or scored movie can't be bid on any more, so offering
    // "Counter bid" on one is a dead end -- the server rejects it once the modal
    // is filled in. A scored one says so: its bids cancel at processing.
    const releaseDate = item.type === 'pickup'
      ? item.bid.movie_data?.release_date ?? null
      : item.bid.movies?.release_date ?? null
    const scoreLocked = item.type === 'pickup'
      ? scoredTmdbIds.has(item.bid.tmdb_id)
      : isScoreLocked(item.bid.movies?.fantasy_points)
    const canCounter = bidding.hasLoaded && bidding.budget !== null && !bidding.error &&
      isMovieBiddable(releaseDate) && !scoreLocked

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
          onCancel={isOwner && !isCounterBidPhase ? () => handleCancelBid(item.bid.id, section) : undefined}
          cancelLocked={isOwner && isCounterBidPhase}
          onCounter={canCounter ? () => openPlaceBid(item.bid) : undefined}
          counterWindowClosesAt={pickupCounterWindows.get(item.bid.tmdb_id) ?? null}
          scoreLocked={scoreLocked}
        />
      )
    }
    return (
      <CounterpickBidCard
        bid={item.bid}
        isOwner={isOwner}
        bidType="counterpick"
        onCancel={isOwner && !isCounterBidPhase ? () => handleCancelCounterpickBid(item.bid.id, section) : undefined}
        cancelLocked={isOwner && isCounterBidPhase}
        onCounter={canCounter ? () => openCounterpickBid(item.bid) : undefined}
        counterWindowClosesAt={counterpickCounterWindows.get(item.bid.movie_id) ?? null}
        scoreLocked={scoreLocked}
      />
    )
  }

  // Cards stagger in rather than appearing at once, so a long list reads as one
  // arriving group instead of a flash.
  function renderBidList(items: UnifiedBidItem[], isOwner: boolean, section: SectionKey): React.ReactElement[] {
    return items.map((item, index) => (
      <li
        key={bidKeyOf(item.type, item.bid.id)}
        data-bid-key={bidKeyOf(item.type, item.bid.id)}
        className="animate-slide-up motion-reduce:animate-none"
        style={{ animationDelay: `${Math.min(index * 50, 150)}ms` }}
      >
        {renderBidItem(item, isOwner, section)}
      </li>
    ))
  }

  const priorityButton = canEditPriority ? (
    <button
      type="button"
      className="btn btn-secondary min-h-11 px-4 py-2"
      data-testid="edit-bid-priority"
      aria-haspopup="dialog"
      onClick={() => setIsPriorityModalOpen(true)}
    >
      <ListOrdered className="w-4 h-4 mr-2" aria-hidden="true" />
      Edit priority
    </button>
  ) : null

  if (!bidding.hasLoaded) {
    if (bidding.error) return <div data-testid="active-bids-panel" />

    return (
      <div className="space-y-3" role="status" data-testid="active-bids-loading">
        <span className="sr-only">Loading active bids…</span>
        <div className="skeleton h-7 w-44 rounded" aria-hidden="true" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="card p-4 flex gap-4" aria-hidden="true">
            <div className="skeleton h-24 w-16 shrink-0 rounded" />
            <div className="flex-1 space-y-3 py-1">
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton h-4 w-1/3 rounded" />
              <div className="skeleton h-7 w-20 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={panelRef} className="space-y-6" data-testid="active-bids-panel">
      {actionRequiredItems.length > 0 && (
        <UnifiedBidSection
          sectionKey="action-required"
          title="Action Required"
          icon={
            <div className="p-1.5 bg-warning-bg rounded-lg">
              <AlertCircle className="w-5 h-5 text-warning" aria-hidden="true" />
            </div>
          }
          count={actionRequiredItems.length}
          action={myActiveItems.length === 0 ? priorityButton : undefined}
          className="animate-fade-in"
        >
          {renderBidList(actionRequiredItems, true, 'action-required')}
        </UnifiedBidSection>
      )}

      {isPriorityModalOpen && <BidPriorityModal onClose={closePriorityModal} />}

      {myActiveItems.length > 0 && (
        <UnifiedBidSection
          sectionKey="my-active"
          title="My Active Bids"
          icon={
            <div className="p-1.5 bg-gold-muted rounded-lg">
              <Sparkles className="w-5 h-5 text-gold" aria-hidden="true" />
            </div>
          }
          count={myActiveItems.length}
          action={priorityButton}
        >
          {renderBidList(myActiveItems, true, 'my-active')}
        </UnifiedBidSection>
      )}

      {competingItems.length > 0 && (
        <UnifiedBidSection
          sectionKey="competing"
          title="Competing Bids"
          icon={
            <div className="p-1.5 bg-elevated rounded-lg">
              <TrendingUp className="w-5 h-5 text-foreground-secondary" aria-hidden="true" />
            </div>
          }
          count={competingItems.length}
          titleClassName="text-foreground-secondary"
        >
          {renderBidList(competingItems, false, 'competing')}
        </UnifiedBidSection>
      )}

      {!hasAnyBids && (
        <div className="card p-10 text-center animate-fade-in">
          <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Film className="w-8 h-8 text-foreground-muted" aria-hidden="true" />
          </div>
          <h3 tabIndex={-1} data-section-heading="empty" className="type-panel text-foreground mb-2 focus:outline-none">
            No active bids
          </h3>
          <p className="text-foreground-secondary mb-6 max-w-md mx-auto">
            Place a bid on upcoming movies to add them to your roster.
            {hasCounterpicks
              ? ' Or place a counterpick bid to bet against opponent movies.'
              : ' Movies are awarded to the highest bidder when bidding closes.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => openPlaceBid()}
              disabled={!canOpenBidModal}
              className="btn btn-primary px-6 py-3"
            >
              <Plus className="w-5 h-5 mr-2" aria-hidden="true" />
              Place your first bid
            </button>
            {canPlaceCounterpickBid && (
              <button
                type="button"
                onClick={() => openCounterpickBid()}
                className="btn btn-secondary px-6 py-3 border-crimson text-crimson-text hover:bg-crimson/10"
              >
                <Target className="w-5 h-5 mr-2" aria-hidden="true" />
                Place counterpick bid
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
