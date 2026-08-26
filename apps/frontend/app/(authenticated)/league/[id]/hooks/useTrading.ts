'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { fetchTradeableMovies } from '@/utils/holdings'
import type { ResolvedExpiry } from '@/utils/tradeExpiry'
import type {
  TradeActionResult,
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
    message?: string,
    expiry?: ResolvedExpiry
  ) => Promise<TradeActionResult>
  respondTrade: (
    tradeOfferId: string,
    response: 'accept' | 'reject',
    message?: string
  ) => Promise<TradeActionResult>
  counterTrade: (
    tradeOfferId: string,
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string,
    expiry?: ResolvedExpiry
  ) => Promise<TradeActionResult>
  cancelTrade: (tradeOfferId: string) => Promise<TradeActionResult>
  vetoTrade: (
    tradeOfferId: string,
    reason?: string
  ) => Promise<TradeActionResult>
  /** Commissioner: end the review period now and process the trade immediately. */
  approveTrade: (tradeOfferId: string) => Promise<TradeActionResult>
  /**
   * Proposer: push their own offer's clock out. Forward only, and the server
   * re-checks that -- the button can only ever offer later times, but nothing
   * stops a crafted call.
   */
  extendTrade: (tradeOfferId: string, expiresAt: string) => Promise<TradeActionResult>
  refreshTrades: () => Promise<void>
  refreshRoster: () => Promise<void>
}

/**
 * The offending item ids from a failed trade call, read off the 4xx body the
 * Edge Function attached. Absent or malformed means "no particular item", which
 * is the right answer for a whole-deal failure like budget or roster size.
 */
function invalidSourceIdsFrom(errorBody: Record<string, unknown> | null): string[] {
  const ids = errorBody?.invalid_source_ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
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
  const loadTradeableMovies = useCallback(async () => {
    try {
      setTradeableMovies(await fetchTradeableMovies(supabase, teamId))
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
      await Promise.all([fetchTrades(), loadTradeableMovies(), fetchBudget()])
      setIsLoading(false)
    }
    init()
  }, [fetchTrades, loadTradeableMovies, fetchBudget])

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
            loadTradeableMovies()
            fetchBudget()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, fetchTrades, loadTradeableMovies, fetchBudget])

  // Propose a new trade
  const proposeTrade = useCallback(
    async (
      recipientTeamId: string,
      offeredItems: TradeItems,
      requestedItems: TradeItems,
      message?: string,
      expiry?: ResolvedExpiry
    ): Promise<TradeActionResult> => {
      const { error: proposeError, errorBody } = await callEdgeFunction('propose-trade', {
        body: {
          league_id: leagueId,
          recipient_team_id: recipientTeamId,
          offered_items: offeredItems,
          requested_items: requestedItems,
          message,
          expires_at: expiry?.expires_at ?? null,
          expiry_anchor: expiry?.expiry_anchor ?? null,
          expiry_anchor_movie_id: expiry?.expiry_anchor_movie_id ?? null,
        },
      })

      if (proposeError) {
        return {
          success: false,
          error: proposeError,
          invalidSourceIds: invalidSourceIdsFrom(errorBody),
        }
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
    ): Promise<TradeActionResult> => {
      const { error: respondError, errorBody } = await callEdgeFunction('respond-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          response,
          message,
        },
      })

      if (respondError) {
        // Any refusal means this client's view of the offer may be stale -- most
        // often because it lapsed between render and click, which is possible
        // whenever the sweep has not caught up. Refetch so the card reflects
        // what the server thinks rather than leaving a dead offer on screen
        // behind an error. Matching on the message text would be cheaper but
        // ties recovery to English copy produced by three different layers.
        await fetchTrades()
        return {
          success: false,
          error: respondError,
          invalidSourceIds: invalidSourceIdsFrom(errorBody),
        }
      }

      await fetchTrades()
      // If accepted, roster will change - refresh it
      if (response === 'accept') {
        await Promise.all([loadTradeableMovies(), fetchBudget()])
      }
      return { success: true }
    },
    [fetchTrades, loadTradeableMovies, fetchBudget]
  )

  // Counter a trade
  const counterTrade = useCallback(
    async (
      tradeOfferId: string,
      counterOfferedItems: TradeItems,
      counterRequestedItems: TradeItems,
      message?: string,
      expiry?: ResolvedExpiry
    ): Promise<TradeActionResult> => {
      const { error: counterError, errorBody } = await callEdgeFunction('counter-trade', {
        body: {
          trade_offer_id: tradeOfferId,
          counter_offered_items: counterOfferedItems,
          counter_requested_items: counterRequestedItems,
          message,
          expires_at: expiry?.expires_at ?? null,
          expiry_anchor: expiry?.expiry_anchor ?? null,
          expiry_anchor_movie_id: expiry?.expiry_anchor_movie_id ?? null,
        },
      })

      if (counterError) {
        // Same reasoning as respondTrade: refresh on any refusal.
        await fetchTrades()
        return {
          success: false,
          error: counterError,
          invalidSourceIds: invalidSourceIdsFrom(errorBody),
        }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades]
  )

  // Cancel a trade
  const cancelTrade = useCallback(
    async (tradeOfferId: string): Promise<TradeActionResult> => {
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
    ): Promise<TradeActionResult> => {
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
    async (tradeOfferId: string): Promise<TradeActionResult> => {
      const { error: approveError } = await callEdgeFunction('approve-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      if (approveError) {
        return { success: false, error: approveError }
      }

      // Unlike veto, this moves movies and budget right away -- and the
      // commissioner may be a party to the trade -- so refresh the roster too.
      await Promise.all([fetchTrades(), loadTradeableMovies(), fetchBudget()])
      return { success: true }
    },
    [fetchTrades, loadTradeableMovies, fetchBudget]
  )

  // Extend an offer's clock (proposer only)
  const extendTrade = useCallback(
    async (tradeOfferId: string, expiresAt: string): Promise<TradeActionResult> => {
      const { error: extendError } = await callEdgeFunction('extend-trade-offer', {
        body: { trade_offer_id: tradeOfferId, expires_at: expiresAt },
      })

      if (extendError) {
        // Same reasoning as respondTrade: a refusal usually means this client's
        // view of the offer is stale -- most often it lapsed between render and
        // click -- so refetch rather than leave a dead offer on screen behind an
        // error message.
        await fetchTrades()
        return { success: false, error: extendError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades]
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
    await Promise.all([loadTradeableMovies(), fetchBudget()])
  }, [loadTradeableMovies, fetchBudget])

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
    extendTrade,
    refreshTrades: fetchTrades,
    refreshRoster,
  }
}
