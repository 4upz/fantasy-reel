'use client'

import { useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { trackEvent } from '@/utils/analytics'
import type { PickupBid, TeamBudget, CounterpickBid } from '@/types'

interface UseBiddingOptions {
  leagueId: string
  teamId: string
  userId: string
}

const EMPTY_PICKUP_BIDS: PickupBid[] = []
const EMPTY_COUNTERPICK_BIDS: CounterpickBid[] = []

// Gameplay changes while a tab is away. Keep warm data on return, but refresh
// promptly instead of inheriting the minute-long movie catalogue cache window.
const BIDDING_CACHE_OPTIONS = {
  dedupingInterval: 2_000,
  revalidateOnFocus: true,
}

/** A holding the bidder wants released if -- and only if -- the bid wins. */
export interface ConditionalDropSelection {
  source: 'draft' | 'pickup'
  holdingId: string
}

export interface UseBiddingReturn {
  bids: PickupBid[]
  myBids: PickupBid[]
  budget: TeamBudget | null
  /** Pickup contests are known, so a composed bid can be validated. */
  bidsReady: boolean
  loading: boolean
  refreshing: boolean
  /** All four resources have loaded, including a genuinely absent budget. */
  hasLoaded: boolean
  error: string | null
  placeBid: (
    tmdbId: number,
    amount: number,
    movieData?: Record<string, unknown>,
    conditionalDrop?: ConditionalDropSelection | null
  ) => Promise<{ success: boolean; error?: string }>
  cancelBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  /** Rewrites the team's pickup bid priorities to the given order, most wanted first. */
  setBidPriorities: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
  refetch: () => Promise<void>
  counterpickBids: CounterpickBid[]
  myCounterpickBids: CounterpickBid[]
  biddingCounterpickCount: number
  placeCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  cancelCounterpickBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  /** Rewrites the team's counterpick bid priorities to the given order, most wanted first. */
  setCounterpickBidPriorities: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

export function useBidding({ leagueId, teamId, userId }: UseBiddingOptions): UseBiddingReturn {
  const supabase = useMemo(() => createClient(), [])

  const fetchBids = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('pickup_bids')
      .select('*')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError
    return (data ?? []) as PickupBid[]
  }, [supabase, leagueId])

  const fetchBudget = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('team_budgets')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle()

    if (fetchError) throw fetchError
    return data as TeamBudget | null
  }, [supabase, teamId])

  const fetchCounterpickBids = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('counterpick_bids')
      .select('*, movies(title, poster_url, release_date, fantasy_points), target_team:teams!counterpick_bids_target_team_id_fkey(name)')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError
    return (data ?? []) as CounterpickBid[]
  }, [supabase, leagueId])

  const fetchBiddingCounterpickCount = useCallback(async () => {
    const { count, error: fetchError } = await supabase
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('counterpicker_team_id', teamId)
      .eq('phase', 'bidding')

    if (fetchError) throw fetchError
    return count ?? 0
  }, [supabase, teamId])

  // Scope every cache entry to the viewer so switching accounts cannot reuse
  // another user's RLS-filtered data. Separate resources keep realtime updates
  // from refetching unrelated tables.
  const pickupState = useSWR(
    ['bidding-pickups', userId, leagueId, teamId], fetchBids, BIDDING_CACHE_OPTIONS,
  )
  const budgetState = useSWR(
    ['bidding-budget', userId, teamId], fetchBudget, BIDDING_CACHE_OPTIONS,
  )
  const counterpickState = useSWR(
    ['bidding-counterpicks', userId, leagueId, teamId], fetchCounterpickBids, BIDDING_CACHE_OPTIONS,
  )
  const countState = useSWR(
    ['bidding-counterpick-count', userId, teamId], fetchBiddingCounterpickCount, BIDDING_CACHE_OPTIONS,
  )

  const { mutate: refreshBids } = pickupState
  const { mutate: refreshBudget } = budgetState
  const { mutate: refreshCounterpickBids } = counterpickState
  const { mutate: refreshCounterpickCount } = countState

  const refetch = useCallback(async () => {
    await Promise.all([
      refreshBids(), refreshBudget(), refreshCounterpickBids(), refreshCounterpickCount(),
    ])
  }, [refreshBids, refreshBudget, refreshCounterpickBids, refreshCounterpickCount])

  const bids = pickupState.data ?? EMPTY_PICKUP_BIDS
  const bidsReady = pickupState.data !== undefined && !pickupState.error
  const counterpickBids = counterpickState.data ?? EMPTY_COUNTERPICK_BIDS
  const budget = budgetState.data ?? null
  const biddingCounterpickCount = countState.data ?? 0
  const hasLoaded = pickupState.data !== undefined && budgetState.data !== undefined &&
    counterpickState.data !== undefined && countState.data !== undefined
  const loading = pickupState.isLoading || budgetState.isLoading ||
    counterpickState.isLoading || countState.isLoading
  const refreshing = pickupState.isValidating || budgetState.isValidating ||
    counterpickState.isValidating || countState.isValidating
  const error = (pickupState.error ?? budgetState.error ?? counterpickState.error ?? countState.error)
    ?.message ?? null

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`bidding-${leagueId}-${teamId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pickup_bids',
        filter: `league_id=eq.${leagueId}`,
      }, () => { void refreshBids() })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_budgets',
        filter: `team_id=eq.${teamId}`,
      }, () => { void refreshBudget() })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'counterpick_bids',
        filter: `league_id=eq.${leagueId}`,
      }, () => { void refreshCounterpickBids() })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'counterpicks',
        filter: `counterpicker_team_id=eq.${teamId}`,
      }, () => { void refreshCounterpickCount() })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, teamId, refreshBids, refreshBudget, refreshCounterpickBids, refreshCounterpickCount])

  const placeBid = useCallback(async (
    tmdbId: number,
    amount: number,
    movieData?: Record<string, unknown>,
    conditionalDrop?: ConditionalDropSelection | null
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: bidError } = await callEdgeFunction<{ bid: PickupBid }>('place-bid', {
      body: {
        league_id: leagueId,
        tmdb_id: tmdbId,
        amount,
        movie_data: movieData,
        // The holding lives in one of two tables, so the source picks the column.
        conditional_drop_draft_pick_id:
          conditionalDrop?.source === 'draft' ? conditionalDrop.holdingId : null,
        conditional_drop_pickup_id:
          conditionalDrop?.source === 'pickup' ? conditionalDrop.holdingId : null,
      },
    })

    if (bidError) {
      return { success: false, error: bidError }
    }

    await refreshBids()
    trackEvent('bid_placed', { league_id: leagueId, amount })
    return { success: true }
  }, [leagueId, refreshBids])

  const cancelBid = useCallback(async (bidId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: cancelError } = await callEdgeFunction('cancel-bid', {
      body: { bid_id: bidId },
    })

    if (cancelError) {
      return { success: false, error: cancelError }
    }

    await refreshBids()
    return { success: true }
  }, [refreshBids])

  const placeCounterpickBid = useCallback(async (
    movieId: string,
    amount: number,
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: bidError } = await callEdgeFunction<{ bid: CounterpickBid }>('place-counterpick-bid', {
      body: {
        league_id: leagueId,
        movie_id: movieId,
        amount,
      },
    })

    if (bidError) {
      return { success: false, error: bidError }
    }

    await refreshCounterpickBids()
    return { success: true }
  }, [leagueId, refreshCounterpickBids])

  const cancelCounterpickBid = useCallback(async (bidId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: cancelError } = await callEdgeFunction('cancel-counterpick-bid', {
      body: { bid_id: bidId },
    })

    if (cancelError) {
      return { success: false, error: cancelError }
    }

    await refreshCounterpickBids()
    return { success: true }
  }, [refreshCounterpickBids])

  const setBidPriorities = useCallback(async (
    bidIds: string[]
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: priorityError } = await callEdgeFunction('set-bid-priorities', {
      body: { league_id: leagueId, bid_ids: bidIds },
    })

    if (priorityError) {
      return { success: false, error: priorityError }
    }

    await refreshBids()
    return { success: true }
  }, [leagueId, refreshBids])

  const setCounterpickBidPriorities = useCallback(async (
    bidIds: string[]
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: priorityError } = await callEdgeFunction('set-counterpick-bid-priorities', {
      body: { league_id: leagueId, bid_ids: bidIds },
    })

    if (priorityError) {
      return { success: false, error: priorityError }
    }

    await refreshCounterpickBids()
    return { success: true }
  }, [leagueId, refreshCounterpickBids])

  // Memoize to prevent re-renders (rerender-memo optimization)
  // Priority order is the order the team chose, so surface it that way everywhere.
  const myBids = useMemo(
    () => bids
      .filter(bid => bid.team_id === teamId)
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [bids, teamId]
  )
  // Priority order is the order the team chose, so surface it that way everywhere.
  const myCounterpickBids = useMemo(
    () => counterpickBids
      .filter(bid => bid.team_id === teamId)
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [counterpickBids, teamId]
  )

  return {
    bids,
    myBids,
    budget,
    bidsReady,
    loading,
    refreshing,
    hasLoaded,
    error,
    placeBid,
    cancelBid,
    setBidPriorities,
    refetch,
    counterpickBids,
    myCounterpickBids,
    biddingCounterpickCount,
    placeCounterpickBid,
    cancelCounterpickBid,
    setCounterpickBidPriorities,
  }
}
