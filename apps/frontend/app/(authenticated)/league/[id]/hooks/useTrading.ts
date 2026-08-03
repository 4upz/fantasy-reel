'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/client'
import type {
  TradeItems,
  TradeOfferWithTeams,
  TradeableMovie,
  TeamBudget,
} from '@/types'

interface UseTradingOptions {
  leagueId: string
  teamId: string
}

interface UseTradingReturn {
  trades: TradeOfferWithTeams[]
  pendingTrades: TradeOfferWithTeams[]
  myTrades: TradeOfferWithTeams[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  isLoading: boolean
  error: string | null
  proposeTrade: (
    recipientTeamId: string,
    offeredItems: TradeItems,
    requestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  respondTrade: (
    tradeOfferId: string,
    response: 'accept' | 'reject',
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  counterTrade: (
    tradeOfferId: string,
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  cancelTrade: (tradeOfferId: string) => Promise<{ success: boolean; error?: string }>
  vetoTrade: (
    tradeOfferId: string,
    reason?: string
  ) => Promise<{ success: boolean; error?: string }>
  refreshTrades: () => Promise<void>
  refreshRoster: () => Promise<void>
}

export function useTrading({ leagueId, teamId }: UseTradingOptions): UseTradingReturn {
  const [trades, setTrades] = useState<TradeOfferWithTeams[]>([])
  const [tradeableMovies, setTradeableMovies] = useState<TradeableMovie[]>([])
  const [budget, setBudget] = useState<TeamBudget | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // Cache auth session to avoid redundant getSession() calls (client-swr-dedup optimization)
  const sessionRef = useRef<Session | null>(null)

  const getSession = useCallback(async (): Promise<Session | null> => {
    if (!sessionRef.current) {
      const { data: { session } } = await supabase.auth.getSession()
      sessionRef.current = session
    }
    return sessionRef.current
  }, [supabase])

  // Clear session cache on auth state change
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionRef.current = session
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  // Fetch trades
  const fetchTrades = useCallback(async () => {
    try {
      const session = await getSession()
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/get-trades?league_id=${leagueId}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error('Failed to fetch trades')
      }

      const data = await response.json()
      setTrades(data.trades || [])
    } catch (err) {
      console.error('Error fetching trades:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch trades')
    }
  }, [leagueId, getSession])

  // Fetch tradeable movies (team's roster)
  const fetchTradeableMovies = useCallback(async () => {
    try {
      // Fetch draft picks
      const { data: draftPicks } = await supabase
        .from('draft_picks')
        .select('id, movie_id, movies(id, title, poster_url, release_date, combined_score, fantasy_points)')
        .eq('team_id', teamId)
        .is('dropped_at', null)

      // Fetch pickups
      const { data: pickups } = await supabase
        .from('pickups')
        .select('id, movie_id, movies(id, title, poster_url, release_date, combined_score, fantasy_points)')
        .eq('team_id', teamId)
        .is('dropped_at', null)

      const movies: TradeableMovie[] = []

      type MovieData = {
        id: string
        title: string
        poster_url: string | null
        release_date: string | null
        combined_score: number | null
        fantasy_points: number | null
      }

      if (draftPicks) {
        for (const pick of draftPicks) {
          const movie = pick.movies as unknown as MovieData | null
          if (movie) {
            movies.push({
              movie_id: movie.id,
              source: 'draft_pick',
              source_id: pick.id,
              title: movie.title,
              poster_url: movie.poster_url,
              release_date: movie.release_date,
              combined_score: movie.combined_score,
              fantasy_points: movie.fantasy_points,
            })
          }
        }
      }

      if (pickups) {
        for (const pickup of pickups) {
          const movie = pickup.movies as unknown as MovieData | null
          if (movie) {
            movies.push({
              movie_id: movie.id,
              source: 'pickup',
              source_id: pickup.id,
              title: movie.title,
              poster_url: movie.poster_url,
              release_date: movie.release_date,
              combined_score: movie.combined_score,
              fantasy_points: movie.fantasy_points,
            })
          }
        }
      }

      setTradeableMovies(movies)
    } catch (err) {
      console.error('Error fetching tradeable movies:', err)
    }
  }, [supabase, teamId])

  // Fetch budget
  const fetchBudget = useCallback(async () => {
    const { data } = await supabase
      .from('team_budgets')
      .select('*')
      .eq('team_id', teamId)
      .single()

    setBudget(data)
  }, [supabase, teamId])

  // Initial fetch
  useEffect(() => {
    const init = async () => {
      setIsLoading(true)
      await Promise.all([fetchTrades(), fetchTradeableMovies(), fetchBudget()])
      setIsLoading(false)
    }
    init()
  }, [fetchTrades, fetchTradeableMovies, fetchBudget])

  // Real-time subscription for trades
  useEffect(() => {
    const channel = supabase
      .channel(`trades:${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trade_offers',
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          fetchTrades()
          // If a trade was completed or accepted, refetch roster to reflect changes
          const newStatus = (payload.new as { status?: string })?.status
          if (newStatus === 'completed' || newStatus === 'accepted') {
            fetchTradeableMovies()
            fetchBudget()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, fetchTrades, fetchTradeableMovies, fetchBudget])

  // Propose a new trade
  const proposeTrade = useCallback(
    async (
      recipientTeamId: string,
      offeredItems: TradeItems,
      requestedItems: TradeItems,
      message?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const session = await getSession()
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/propose-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              league_id: leagueId,
              recipient_team_id: recipientTeamId,
              offered_items: offeredItems,
              requested_items: requestedItems,
              message,
            }),
          }
        )

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to propose trade' }
        }

        await fetchTrades()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [getSession, leagueId, fetchTrades]
  )

  // Respond to a trade (accept/reject)
  const respondTrade = useCallback(
    async (
      tradeOfferId: string,
      response: 'accept' | 'reject',
      message?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const session = await getSession()
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/respond-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              trade_offer_id: tradeOfferId,
              response,
              message,
            }),
          }
        )

        const data = await res.json()

        if (!res.ok) {
          return { success: false, error: data.error || 'Failed to respond to trade' }
        }

        await fetchTrades()
        // If accepted, roster will change - refresh it
        if (response === 'accept') {
          await Promise.all([fetchTradeableMovies(), fetchBudget()])
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [getSession, fetchTrades, fetchTradeableMovies, fetchBudget]
  )

  // Counter a trade
  const counterTrade = useCallback(
    async (
      tradeOfferId: string,
      counterOfferedItems: TradeItems,
      counterRequestedItems: TradeItems,
      message?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const session = await getSession()
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/counter-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              trade_offer_id: tradeOfferId,
              counter_offered_items: counterOfferedItems,
              counter_requested_items: counterRequestedItems,
              message,
            }),
          }
        )

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to counter trade' }
        }

        await fetchTrades()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [getSession, fetchTrades]
  )

  // Cancel a trade
  const cancelTrade = useCallback(
    async (tradeOfferId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const session = await getSession()
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancel-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ trade_offer_id: tradeOfferId }),
          }
        )

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to cancel trade' }
        }

        await fetchTrades()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [getSession, fetchTrades]
  )

  // Veto a trade (commissioner only)
  const vetoTrade = useCallback(
    async (
      tradeOfferId: string,
      reason?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const session = await getSession()
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/veto-trade`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ trade_offer_id: tradeOfferId, reason }),
          }
        )

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to veto trade' }
        }

        await fetchTrades()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [getSession, fetchTrades]
  )

  // Computed values
  const pendingTrades = trades.filter(
    (t) => t.status === 'proposed' || t.status === 'countered' || t.status === 'review'
  )

  const myTrades = trades.filter(
    (t) => t.initiator_team_id === teamId || t.recipient_team_id === teamId
  )

  // Refresh roster manually (useful after trade completion)
  const refreshRoster = useCallback(async () => {
    await Promise.all([fetchTradeableMovies(), fetchBudget()])
  }, [fetchTradeableMovies, fetchBudget])

  return {
    trades,
    pendingTrades,
    myTrades,
    tradeableMovies,
    budget,
    isLoading,
    error,
    proposeTrade,
    respondTrade,
    counterTrade,
    cancelTrade,
    vetoTrade,
    refreshTrades: fetchTrades,
    refreshRoster,
  }
}
