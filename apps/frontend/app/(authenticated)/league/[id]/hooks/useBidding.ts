'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { PickupBid, TeamBudget } from '@/types'

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
}

export function useBidding({ leagueId, teamId }: UseBiddingOptions): UseBiddingReturn {
  const [bids, setBids] = useState<PickupBid[]>([])
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

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([fetchBids(), fetchBudget()])
    setLoading(false)
  }, [fetchBids, fetchBudget])

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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, teamId, fetchBids, fetchBudget])

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

  // Memoize to prevent re-renders (rerender-memo optimization)
  const myBids = useMemo(() => bids.filter(bid => bid.team_id === teamId), [bids, teamId])

  return {
    bids,
    myBids,
    budget,
    loading,
    error,
    placeBid,
    cancelBid,
    refetch,
  }
}
