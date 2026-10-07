'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { Plus, Swords, Target } from 'lucide-react'
import { toast } from 'sonner'
import type { CounterpickBid, League, PickupBid, TeamWithOwner } from '@/types'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { announce } from '@/utils/announce'
import { useBidding } from '../hooks/useBidding'
import BidWeekTimeline from '../components/BidWeekTimeline'
import { getBidPhase } from '../components/utils'
import { getDroppableBidHoldingIds } from '../components/bidFitForecast'
import { BiddingProvider, type BiddingHolding } from './BiddingContext'
import BiddingModalLoading from './BiddingModalLoading'

const PlaceBidModal = dynamic(() => import('../components/PlaceBidModal'), {
  loading: BiddingModalLoading,
})

const PlaceCounterpickBidModal = dynamic(() => import('../components/PlaceCounterpickBidModal'), {
  loading: BiddingModalLoading,
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
  used: number | null
  total: number
  loading?: boolean
}

/** One "used / total" stat in the header rail. */
function SlotStat({ label, used, total, loading = false }: SlotStatProps): React.ReactElement {
  return (
    <div>
      <p className="type-meta text-foreground-secondary mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        {loading ? (
          <span className="skeleton h-8 sm:h-9 w-6 rounded" role="status">
            <span className="sr-only">Loading {label.toLowerCase()}…</span>
          </span>
        ) : (
          <>
            {/* "3 / 8" reads as "3 slash 8"; say what the numbers are. */}
            <span className="type-number-lg text-foreground" aria-hidden="true">{used ?? '—'}</span>
            <span className="sr-only">
              {used === null ? `Unavailable, ${total} slots` : `${used} of ${total} slots used`}
            </span>
          </>
        )}
        <span className="text-foreground-secondary text-base sm:text-lg type-numeric" aria-hidden="true">/ {total}</span>
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
  userId: string
  teams: TeamWithOwner[]
  ownedTmdbIds: number[]
  /** Upcoming movies that already have a score: locked against bids. */
  scoredTmdbIds: number[]
  /** Active holdings across the whole roster: draft picks and pickups share total_slots. */
  usedRosterSlots: number
  /** The team's own holdings, offered as conditional drop targets in the bid modal. */
  myHoldings: BiddingHolding[]
  biddingCounterpickSlots: number
  /** From get_new_bid_cutoff(); null when the league has the cutoff disabled. */
  newBidCutoffAt: string | null
  processingDeadline: string | null
  children: React.ReactNode
}

export default function BiddingShell({
  league,
  teamId,
  userId,
  teams,
  ownedTmdbIds,
  scoredTmdbIds: scoredTmdbIdList,
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

  const bidding = useBidding({ leagueId: league.id, teamId, userId })
  const {
    bids, myBids, budget, counterpickBids, myCounterpickBids,
    biddingCounterpickCount, loading, refreshing, hasLoaded, error,
  } = bidding

  const scoredTmdbIds = useMemo(() => new Set(scoredTmdbIdList), [scoredTmdbIdList])
  const hasCounterpicks = biddingCounterpickSlots > 0
  // Roster slots are pooled: draft picks and pickups draw on the same total.
  const rosterSlots = league.total_slots
  const freeRosterSlots = Math.max(0, rosterSlots - usedRosterSlots)

  // Only holdings that could actually be dropped are offered as conditional
  // drop targets. Mirrors drop-movie's rules (and droppableHoldingIds() in
  // _shared/bid-resolution.ts, which re-checks them at processing time):
  // offering a released or counterpicked movie is a dead end that would fail a
  // week later, when the bid is settled and it is too late to choose again.
  const droppableHoldingIds = useMemo(() => {
    if (!hasLoaded || error) return new Set<string>()
    return getDroppableBidHoldingIds(myHoldings, {
      today: new Date().toISOString().slice(0, 10),
      counterpicksBlockDrops: league.counterpicks_block_drops,
      contestedMovieIds: new Set(counterpickBids.map((bid) => bid.movie_id)),
    })
  }, [myHoldings, league.counterpicks_block_drops, counterpickBids, hasLoaded, error])
  const droppableHoldings = useMemo(
    () => myHoldings.filter((holding) => droppableHoldingIds.has(holding.holding_id)),
    [myHoldings, droppableHoldingIds]
  )
  // Browsing and composing a new bid can start while contests load. The modal
  // waits for those bids before allowing submission without resetting a draft.
  const canSpend = budget !== null && !error
  const canPlaceCounterpickBid = canSpend && hasLoaded && hasCounterpicks && biddingCounterpickCount < biddingCounterpickSlots

  // Past the cutoff the week belongs to counter bidding: only movies already
  // being bid on can be raised or countered, and nothing can be withdrawn. The
  // clock ticks so a page left open crosses the cutoff instead of offering new
  // bids the server will refuse.
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  const { isCounterBidPhase } = useMemo(
    () => getBidPhase(newBidCutoffAt, processingDeadline, new Date(clock)),
    [newBidCutoffAt, processingDeadline, clock]
  )
  const wasCounterBidPhase = useRef(isCounterBidPhase)
  useEffect(() => {
    if (isCounterBidPhase && !wasCounterBidPhase.current) {
      announce('New bids are now closed. You can still raise or counter bids on movies already in play.')
    }
    wasCounterBidPhase.current = isCounterBidPhase
  }, [isCounterBidPhase])

  // An 'outbid' row still counts as a live contest -- that team can counter back.
  const hasContestedBids = useMemo(
    () => bids.some((bid) => bid.status === 'active' || bid.status === 'outbid'),
    [bids]
  )

  // With no contest left to join, the bid modal has nothing to offer.
  const canOpenBidModal = canSpend && (!isCounterBidPhase || hasContestedBids)

  const totalPendingBids = useMemo(
    () => [...myBids, ...myCounterpickBids]
      .filter((bid) => bid.status === 'active' || bid.status === 'outbid')
      .reduce((sum, bid) => sum + bid.amount, 0),
    [myBids, myCounterpickBids]
  )

  const openPlaceBid = useCallback((target?: PickupBid | null) => {
    if (!canOpenBidModal) return
    setCounterBidTarget(target ?? null)
    setIsBidModalOpen(true)
  }, [canOpenBidModal])

  const openCounterpickBid = useCallback((target?: CounterpickBid | null) => {
    if (!canSpend || !hasLoaded) return
    setCounterCounterpickTarget(target ?? null)
    setIsCounterpickModalOpen(true)
  }, [canSpend, hasLoaded])

  // A toast raised while a dialog is open is hidden from screen readers along
  // with the rest of the page, so a bid's confirmation waits for it to close.
  const closedDialogToast = useRef<string | null>(null)
  const closeBidModal = useCallback((successMessage?: string) => {
    closedDialogToast.current = successMessage ?? null
    setIsBidModalOpen(false)
    setCounterBidTarget(null)
  }, [])
  const closeCounterpickModal = useCallback((successMessage?: string) => {
    closedDialogToast.current = successMessage ?? null
    setIsCounterpickModalOpen(false)
    setCounterCounterpickTarget(null)
  }, [])
  useEffect(() => {
    if (isBidModalOpen || isCounterpickModalOpen || !closedDialogToast.current) return
    toast.success(closedDialogToast.current)
    closedDialogToast.current = null
  }, [isBidModalOpen, isCounterpickModalOpen])

  const { execute: retryBidding, isLoading: isRetrying } = useAsyncAction(bidding.refetch)
  // A successful retry removes the alert along with its focused button; hand
  // focus to the bid button it just unblocked.
  const placeBidButtonRef = useRef<HTMLButtonElement>(null)
  const retryAndRefocus = useCallback(async () => {
    if (refreshing) return
    await retryBidding().catch(() => { /* The alert stays up to retry again. */ })
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) placeBidButtonRef.current?.focus()
    })
  }, [refreshing, retryBidding])

  // A disabled button can't be focused, so its reason would never be heard.
  // These stay focusable with aria-disabled and point at text saying why.
  const loadingReasonId = useId()
  const bidReasonId = useId()
  const unavailableAlertId = useId()
  const bidCtaReason = canSpend ? getBidCtaTitle(isCounterBidPhase, hasContestedBids) : undefined
  const unavailableReasonId = loading ? loadingReasonId : unavailableAlertId
  const placeBidReasonId = canOpenBidModal ? undefined : canSpend ? bidReasonId : unavailableReasonId
  const counterpickReasonId = canPlaceCounterpickBid
    ? undefined
    : canSpend && !hasLoaded ? loadingReasonId : unavailableReasonId

  const contextValue = useMemo(
    () => ({
      league,
      teamId,
      teams,
      bidding,
      ownedTmdbIds,
      scoredTmdbIds,
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
      scoredTmdbIds,
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
          <h2 className="sr-only">Bidding</h2>
          <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-6">
            <div>
              <p className="type-meta text-foreground-secondary mb-1">
                Budget<span className="sr-only"> remaining</span>
              </p>
              {loading && !budget && !error ? (
                <div className="skeleton h-8 sm:h-9 w-20 rounded" role="status" data-testid="bidding-budget-loading">
                  <span className="sr-only">Loading budget…</span>
                </div>
              ) : (
                <p className="type-number-lg bid-amount-display" data-testid="bidding-budget">
                  {budget ? `$${budget.remaining_budget}` : '—'}
                </p>
              )}
              {hasLoaded && totalPendingBids > 0 && (
                <p className="type-meta text-foreground-secondary mt-1">
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
                  used={hasLoaded ? biddingCounterpickCount : null}
                  total={biddingCounterpickSlots}
                  loading={loading && !hasLoaded}
                />
              </>
            )}
          </div>

          <BidWeekTimeline cutoffAt={newBidCutoffAt} processingDeadline={processingDeadline} />

          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button
              ref={placeBidButtonRef}
              type="button"
              onClick={() => openPlaceBid()}
              aria-disabled={!canOpenBidModal}
              aria-describedby={placeBidReasonId}
              aria-haspopup="dialog"
              className="btn btn-primary px-6 py-3 text-base w-full sm:w-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-gold aria-disabled:hover:shadow-none"
              data-testid="place-bid-button"
            >
              {isCounterBidPhase ? <Swords className="w-5 h-5 mr-2" aria-hidden="true" /> : <Plus className="w-5 h-5 mr-2" aria-hidden="true" />}
              {isCounterBidPhase ? 'Counter a Bid' : 'Place Bid'}
            </button>

            {hasCounterpicks && (!hasLoaded || biddingCounterpickCount < biddingCounterpickSlots) && (
              <button
                type="button"
                onClick={() => openCounterpickBid()}
                aria-disabled={!canPlaceCounterpickBid}
                aria-describedby={counterpickReasonId}
                aria-haspopup="dialog"
                className="btn btn-secondary px-6 py-3 text-base w-full sm:w-auto border-crimson text-crimson-text hover:bg-crimson/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
                data-testid="place-counterpick-bid-button"
              >
                <Target className="w-5 h-5 mr-2" aria-hidden="true" />
                Place counterpick bid
              </button>
            )}
          </div>

          {bidCtaReason && (
            <p id={bidReasonId} className="type-meta text-foreground-secondary mt-3">
              {bidCtaReason}
            </p>
          )}
          {(loading || !hasLoaded) && (
            <p id={loadingReasonId} className="sr-only">Loading your bidding information…</p>
          )}

          {(error || (hasLoaded && !budget)) && (
            <div className="alert alert-warning mt-4 flex flex-wrap items-center gap-3" role="alert">
              <p id={unavailableAlertId} className="type-body-sm flex-1">
                {error
                  ? 'Could not load the latest bidding information. Try again before placing a bid.'
                  : 'Your team budget is not available yet. Bidding will be available once it is ready.'}
              </p>
              <button
                type="button"
                className="btn btn-secondary px-4 py-2 aria-disabled:cursor-wait aria-disabled:opacity-50"
                onClick={retryAndRefocus}
                aria-disabled={refreshing || isRetrying}
              >
                {refreshing || isRetrying ? 'Loading…' : 'Try again'}
              </button>
            </div>
          )}
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
                  className={`type-control px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
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
          seasonYear={league.season_year}
          isOpen={isBidModalOpen}
          onClose={closeBidModal}
          teamId={teamId}
          budget={budget}
          existingBids={bids}
          bidsReady={bidding.bidsReady && !error}
          bidsError={!!error}
          ownedTmdbIds={ownedTmdbIds}
          scoredTmdbIds={scoredTmdbIds}
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
          onClose={closeCounterpickModal}
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
