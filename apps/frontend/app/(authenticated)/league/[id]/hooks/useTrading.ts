'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
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
  /** Commissioner: end the review period now and process the trade immediately. */
  approveTrade: (tradeOfferId: string) => Promise<{ success: boolean; error?: string }>
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

  // Fetch trades
  const fetchTrades = useCallback(async () => {
    // get-trades supports both GET+query-string and POST+JSON body (see
    // supabase/functions/get-trades/index.ts); POST body matches the
    // callEdgeFunction idiom used by every other call site in this app.
    const { data, error: fetchError } = await callEdgeFunction<{ trades: TradeOfferWithTeams[] }>(
      'get-trades',
      { body: { league_id: leagueId } }
    )

    if (fetchError) {
      setError(fetchError)
      return
    }

    setTrades(data?.trades || [])
  }, [leagueId])

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
      const { error: proposeError } = await callEdgeFunction('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeamId,
          offered_items: offeredItems,
          requested_items: requestedItems,
          message,
        },
      })

      if (proposeError) {
        return { success: false, error: proposeError }
      }

      await fetchTrades()
      return { success: true }
    },
    [leagueId, fetchTrades]
  )

  // Respond to a trade (accept/reject)
  const respondTrade = useCallback(
    async (
      tradeOfferId: string,
      response: 'accept' | 'reject',
      message?: string
    ): Promise<{ success: boolean; error?: string }> => {
      const { error: respondError } = await callEdgeFunction('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response,
          message,
        },
      })

      if (respondError) {
        return { success: false, error: respondError }
      }

      await fetchTrades()
      // If accepted, roster will change - refresh it
      if (response === 'accept') {
        await Promise.all([fetchTradeableMovies(), fetchBudget()])
      }
      return { success: true }
    },
    [fetchTrades, fetchTradeableMovies, fetchBudget]
  )

  // Counter a trade
  const counterTrade = useCallback(
    async (
      tradeOfferId: string,
      counterOfferedItems: TradeItems,
      counterRequestedItems: TradeItems,
      message?: string
    ): Promise<{ success: boolean; error?: string }> => {
      const { error: counterError } = await callEdgeFunction('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: counterOfferedItems,
          counter_requested_items: counterRequestedItems,
          message,
        },
      })

      if (counterError) {
        return { success: false, error: counterError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades]
  )

  // Cancel a trade
  const cancelTrade = useCallback(
    async (tradeOfferId: string): Promise<{ success: boolean; error?: string }> => {
      const { error: cancelError } = await callEdgeFunction('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      if (cancelError) {
        return { success: false, error: cancelError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades]
  )

  // Veto a trade (commissioner only)
  const vetoTrade = useCallback(
    async (
      tradeOfferId: string,
      reason?: string
    ): Promise<{ success: boolean; error?: string }> => {
      const { error: vetoError } = await callEdgeFunction('veto-trade', {
        body: { trade_offer_id: tradeOfferId, reason },
      })

      if (vetoError) {
        return { success: false, error: vetoError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades]
  )

  // Approve a trade immediately (commissioner only)
  const approveTrade = useCallback(
    async (tradeOfferId: string): Promise<{ success: boolean; error?: string }> => {
      const { error: approveError } = await callEdgeFunction('approve-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      if (approveError) {
        return { success: false, error: approveError }
      }

      // Unlike veto, this moves movies and budget right away -- and the
      // commissioner may be a party to the trade -- so refresh the roster too.
      await Promise.all([fetchTrades(), fetchTradeableMovies(), fetchBudget()])
      return { success: true }
    },
    [fetchTrades, fetchTradeableMovies, fetchBudget]
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
    approveTrade,
    refreshTrades: fetchTrades,
    refreshRoster,
  }
}
