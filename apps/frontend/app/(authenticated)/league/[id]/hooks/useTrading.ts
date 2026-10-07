'use client'

import { useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR from 'swr'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { fetchTradeableMovies } from '@/utils/holdings'
import { announce } from '@/utils/announce'
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
  userId: string
  rosterRequested: boolean
}

interface UseTradingReturn {
  trades: TradeOfferWithTeams[]
  pendingTrades: TradeOfferWithTeams[]
  myTrades: TradeOfferWithTeams[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  isLoading: boolean
  error: string | null
  isBudgetLoading: boolean
  budgetError: string | null
  isRosterLoading: boolean
  rosterError: string | null
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
  refreshBudget: () => Promise<void>
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

// League activity can change while another tab is open. Keep cached results for
// immediate revisits, but revalidate them instead of using the movie-cache TTL.
const TRADING_SWR_OPTIONS = {
  dedupingInterval: 2_000,
  revalidateOnMount: true,
  revalidateOnFocus: true,
}

const EMPTY_TRADES: TradeOfferWithTeams[] = []
const EMPTY_MOVIES: TradeableMovie[] = []

/**
 * How long a trade this user just acted on stays out of the change
 * announcements. Their own action is confirmed by the card that took it; the
 * refetch it causes should not be read out a second time as news.
 */
const OWN_ACTION_QUIET_MS = 15_000

/**
 * One line describing what someone else just did to a trade this team is part
 * of, or null when there is nothing to tell them. Sighted users see the card
 * change; this is that change for a screen reader, without reading the card.
 */
function describeTradeChange(
  before: TradeOfferWithTeams | undefined,
  after: TradeOfferWithTeams,
  teamId: string
): string | null {
  const isInitiator = after.initiator_team_id === teamId
  const isRecipient = after.recipient_team_id === teamId
  if (!isInitiator && !isRecipient) return null

  const initiator = after.initiator_team?.name ?? 'Another team'
  const recipient = after.recipient_team?.name ?? 'Another team'
  const other = isInitiator ? recipient : initiator

  if (!before) {
    return isRecipient && after.status === 'proposed' ? `New trade offer from ${initiator}.` : null
  }
  // A counter to a counter keeps the status and swaps the sides.
  const sidesSwapped = before.initiator_team_id !== after.initiator_team_id
  if (before.status === after.status && !sidesSwapped) return null

  switch (after.status) {
    case 'countered':
      return isRecipient ? `${initiator} sent you a counter-offer.` : null
    case 'review':
    case 'accepted':
      return isInitiator ? `${recipient} accepted your trade offer.` : null
    case 'rejected':
      return isInitiator ? `${recipient} rejected your trade offer.` : null
    case 'cancelled':
      return isRecipient ? `${initiator} cancelled their trade offer.` : null
    case 'vetoed':
      return `The commissioner vetoed your trade with ${other}.`
    case 'completed':
      return `Your trade with ${other} went through.`
    case 'expired':
      return `Your trade with ${other} expired.`
    default:
      return null
  }
}

export function useTrading({ leagueId, teamId, userId, rosterRequested }: UseTradingOptions): UseTradingReturn {
  const supabase = useMemo(() => createClient(), [])

  // Keep private offers isolated when accounts change in the same browser.
  const tradesQuery = useSWR<TradeOfferWithTeams[], Error>(
    ['league-trades', leagueId, teamId, userId],
    async () => {
      const { data, error } = await callEdgeFunction<{ trades: TradeOfferWithTeams[] }>(
        'get-trades',
        { body: { league_id: leagueId } }
      )
      if (error) throw new Error(error)
      return data?.trades ?? []
    },
    TRADING_SWR_OPTIONS
  )
  const rosterQuery = useSWR<TradeableMovie[], Error>(
    rosterRequested ? ['league-trade-roster', leagueId, teamId, userId] : null,
    () => fetchTradeableMovies(supabase, teamId),
    TRADING_SWR_OPTIONS
  )
  const budgetQuery = useSWR<TeamBudget | null, Error>(
    ['league-trade-budget', leagueId, teamId, userId],
    async () => {
      const { data, error } = await supabase
        .from('team_budgets')
        .select('*')
        .eq('team_id', teamId)
        .maybeSingle()
      if (error) throw new Error('Unable to load your budget. Please try again.')
      return data
    },
    TRADING_SWR_OPTIONS
  )

  const trades = tradesQuery.data ?? EMPTY_TRADES
  const tradeableMovies = rosterQuery.data ?? EMPTY_MOVIES
  const budget = budgetQuery.data ?? null
  // Offers and the budget rail can render independently. Roster data is only
  // needed to compose an offer, so don't fetch it until that dialog is opened.
  const isLoading = tradesQuery.data === undefined
  const error = tradesQuery.error?.message ?? null
  const { mutate: mutateTrades } = tradesQuery
  const { mutate: mutateRoster } = rosterQuery
  const { mutate: mutateBudget } = budgetQuery
  const fetchTrades = useCallback(async () => {
    await mutateTrades()
  }, [mutateTrades])
  const loadTradeableMovies = useCallback(async () => {
    await mutateRoster()
  }, [mutateRoster])
  const fetchBudget = useCallback(async () => {
    await mutateBudget()
  }, [mutateBudget])

  // Trades this user just acted on, so their own action isn't announced twice.
  const actedOnRef = useRef(new Map<string, number>())
  const markActedOn = useCallback((tradeOfferId: string) => {
    actedOnRef.current.set(tradeOfferId, Date.now())
  }, [])

  // Announce what other people did (a new offer, an answer, a veto) when the
  // trades refetch -- realtime, focus or a manual retry alike. The first load of
  // each account's view is the baseline, not news.
  const viewKey = `${leagueId}:${teamId}:${userId}`
  const previousTradesRef = useRef<{ key: string; trades: Map<string, TradeOfferWithTeams> } | null>(null)
  const tradesData = tradesQuery.data
  useEffect(() => {
    if (!tradesData) return
    const previous = previousTradesRef.current?.key === viewKey ? previousTradesRef.current.trades : null
    previousTradesRef.current = { key: viewKey, trades: new Map(tradesData.map((t) => [t.id, t])) }
    if (!previous) return

    const now = Date.now()
    const messages = tradesData.flatMap((trade) => {
      const actedAt = actedOnRef.current.get(trade.id)
      if (actedAt !== undefined && now - actedAt < OWN_ACTION_QUIET_MS) return []
      const message = describeTradeChange(previous.get(trade.id), trade, teamId)
      return message ? [message] : []
    })
    if (messages.length > 0) announce(messages.join(' '))
  }, [tradesData, viewKey, teamId])

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_budgets', filter: `team_id=eq.${teamId}` },
        fetchBudget
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, teamId, fetchTrades, loadTradeableMovies, fetchBudget])

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
      markActedOn(tradeOfferId)
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

      await Promise.all([
        fetchTrades(),
        ...(response === 'accept' ? [loadTradeableMovies(), fetchBudget()] : []),
      ])
      return { success: true }
    },
    [fetchTrades, loadTradeableMovies, fetchBudget, markActedOn]
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
      markActedOn(tradeOfferId)
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
    [fetchTrades, markActedOn]
  )

  // Cancel a trade
  const cancelTrade = useCallback(
    async (tradeOfferId: string): Promise<TradeActionResult> => {
      markActedOn(tradeOfferId)
      const { error: cancelError } = await callEdgeFunction('cancel-trade', {
        body: { trade_offer_id: tradeOfferId },
      })

      if (cancelError) {
        return { success: false, error: cancelError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades, markActedOn]
  )

  // Veto a trade (commissioner only)
  const vetoTrade = useCallback(
    async (
      tradeOfferId: string,
      reason?: string
    ): Promise<TradeActionResult> => {
      markActedOn(tradeOfferId)
      const { error: vetoError } = await callEdgeFunction('veto-trade', {
        body: { trade_offer_id: tradeOfferId, reason },
      })

      if (vetoError) {
        return { success: false, error: vetoError }
      }

      await fetchTrades()
      return { success: true }
    },
    [fetchTrades, markActedOn]
  )

  // Approve a trade immediately (commissioner only)
  const approveTrade = useCallback(
    async (tradeOfferId: string): Promise<TradeActionResult> => {
      markActedOn(tradeOfferId)
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
    [fetchTrades, loadTradeableMovies, fetchBudget, markActedOn]
  )

  // Extend an offer's clock (proposer only)
  const extendTrade = useCallback(
    async (tradeOfferId: string, expiresAt: string): Promise<TradeActionResult> => {
      markActedOn(tradeOfferId)
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
    [fetchTrades, markActedOn]
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
    isBudgetLoading: budgetQuery.data === undefined,
    budgetError: budgetQuery.error?.message ?? null,
    isRosterLoading: rosterQuery.data === undefined,
    rosterError: rosterQuery.error?.message ?? null,
    proposeTrade,
    respondTrade,
    counterTrade,
    cancelTrade,
    vetoTrade,
    approveTrade,
    extendTrade,
    refreshTrades: fetchTrades,
    refreshRoster,
    refreshBudget: fetchBudget,
  }
}
