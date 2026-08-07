'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { trackEvent } from '@/utils/analytics'
import type { PickupBid, TeamBudget, CounterpickBid } from '@/types'

interface UseBiddingOptions {
  leagueId: string
  teamId: string
}

interface UseBiddingReturn {
  bids: PickupBid[]
  myBids: PickupBid[]
  budget: TeamBudget | null
  loading: boolean
  error: string | null
  placeBid: (tmdbId: number, amount: number, movieData?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  cancelBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  refetch: () => Promise<void>
  counterpickBids: CounterpickBid[]
  myCounterpickBids: CounterpickBid[]
  biddingCounterpickCount: number
  placeCounterpickBid: (movieId: string, amount: number) => Promise<{ success: boolean; error?: string }>
  cancelCounterpickBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  /** Rewrites the team's counterpick bid priorities to the given order, most wanted first. */
  setCounterpickBidPriorities: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
}

export function useBidding({ leagueId, teamId }: UseBiddingOptions): UseBiddingReturn {
  const [bids, setBids] = useState<PickupBid[]>([])
  const [counterpickBids, setCounterpickBids] = useState<CounterpickBid[]>([])
  const [biddingCounterpickCount, setBiddingCounterpickCount] = useState(0)
  const [budget, setBudget] = useState<TeamBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Memoize to prevent re-renders (rerender-memo optimization)
  const supabase = useMemo(() => createClient(), [])

  const fetchBids = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('pickup_bids')
      .select('*')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setBids(data || [])
    }
  }, [supabase, leagueId])

  const fetchBudget = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('team_budgets')
      .select('*')
      .eq('team_id', teamId)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      setError(fetchError.message)
    } else {
      setBudget(data)
    }
  }, [supabase, teamId])

  const fetchCounterpickBids = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('counterpick_bids')
      .select('*, movies(title, poster_url, release_date, fantasy_points), target_team:teams!counterpick_bids_target_team_id_fkey(name)')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setCounterpickBids((data as CounterpickBid[]) || [])
    }
  }, [supabase, leagueId])

  const fetchBiddingCounterpickCount = useCallback(async () => {
    const { count, error: fetchError } = await supabase
      .from('counterpicks')
      .select('*', { count: 'exact', head: true })
      .eq('counterpicker_team_id', teamId)
      .eq('phase', 'bidding')

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setBiddingCounterpickCount(count ?? 0)
    }
  }, [supabase, teamId])

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([fetchBids(), fetchBudget(), fetchCounterpickBids(), fetchBiddingCounterpickCount()])
    setLoading(false)
  }, [fetchBids, fetchBudget, fetchCounterpickBids, fetchBiddingCounterpickCount])

  // Initial fetch
  useEffect(() => {
    refetch()
  }, [refetch])

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`bidding-${leagueId}-${teamId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pickup_bids',
        filter: `league_id=eq.${leagueId}`,
      }, () => fetchBids())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_budgets',
        filter: `team_id=eq.${teamId}`,
      }, () => fetchBudget())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'counterpick_bids',
        filter: `league_id=eq.${leagueId}`,
      }, () => fetchCounterpickBids())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'counterpicks',
        filter: `counterpicker_team_id=eq.${teamId}`,
      }, () => fetchBiddingCounterpickCount())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, teamId, fetchBids, fetchBudget, fetchCounterpickBids, fetchBiddingCounterpickCount])

  const placeBid = useCallback(async (
    tmdbId: number,
    amount: number,
    movieData?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: bidError } = await callEdgeFunction<{ bid: PickupBid }>('place-bid', {
      body: {
        league_id: leagueId,
        tmdb_id: tmdbId,
        amount,
        movie_data: movieData,
      },
    })

    if (bidError) {
      return { success: false, error: bidError }
    }

    await refetch()
    trackEvent('bid_placed', { league_id: leagueId, amount })
    return { success: true }
  }, [leagueId, refetch])

  const cancelBid = useCallback(async (bidId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: cancelError } = await callEdgeFunction('cancel-bid', {
      body: { bid_id: bidId },
    })

    if (cancelError) {
      return { success: false, error: cancelError }
    }

    await refetch()
    return { success: true }
  }, [refetch])

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

    await refetch()
    return { success: true }
  }, [leagueId, refetch])

  const cancelCounterpickBid = useCallback(async (bidId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: cancelError } = await callEdgeFunction('cancel-counterpick-bid', {
      body: { bid_id: bidId },
    })

    if (cancelError) {
      return { success: false, error: cancelError }
    }

    await refetch()
    return { success: true }
  }, [refetch])

  const setCounterpickBidPriorities = useCallback(async (
    bidIds: string[]
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: priorityError } = await callEdgeFunction('set-counterpick-bid-priorities', {
      body: { league_id: leagueId, bid_ids: bidIds },
    })

    if (priorityError) {
      return { success: false, error: priorityError }
    }

    await refetch()
    return { success: true }
  }, [leagueId, refetch])

  // Memoize to prevent re-renders (rerender-memo optimization)
  const myBids = useMemo(() => bids.filter(bid => bid.team_id === teamId), [bids, teamId])
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
    loading,
    error,
    placeBid,
    cancelBid,
    refetch,
    counterpickBids,
    myCounterpickBids,
    biddingCounterpickCount,
    placeCounterpickBid,
    cancelCounterpickBid,
    setCounterpickBidPriorities,
  }
}
