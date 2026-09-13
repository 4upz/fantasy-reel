'use client'

import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import type { League, Team, TeamWithOwner, TradeItems } from '@/types'
import { useTrading } from '../hooks/useTrading'
import TradingPanel from '../components/TradingPanel'
import TradeComposerLoading, { type TradeComposerState } from '../components/TradeComposerLoading'
import { trackEvent } from '@/utils/analytics'
import { resolveExpiryBounds, type ResolvedExpiry } from '@/utils/tradeExpiry'
import { useAsyncAction } from '@/hooks/useAsyncAction'

// Start the dialog chunk alongside its data; Suspense keeps preparation cancellable.
const loadProposeTradeModal = () => import('../components/ProposeTradeModal')
const ProposeTradeModal = lazy(loadProposeTradeModal)

interface Props {
  league: League
  team: Team
  currentTeam: TeamWithOwner
  otherTeams: TeamWithOwner[]
  isOwner: boolean
  userId: string
}

export default function TradingClient({ league, team, currentTeam, otherTeams, isOwner, userId }: Props) {
  const [showProposeModal, setShowProposeModal] = useState(false)
  const [rosterRequested, setRosterRequested] = useState(false)

  // Derived once for the whole page: both the propose modal and every card's
  // counter/extend modal need the same rules, and a fresh object per consumer
  // would re-run useOfferExpiry's memos on every render.
  const expiryBounds = useMemo(() => resolveExpiryBounds(league), [league])

  const {
    trades,
    pendingTrades,
    myTrades,
    tradeableMovies,
    budget,
    isLoading,
    error,
    isBudgetLoading,
    budgetError,
    isRosterLoading,
    rosterError,
    proposeTrade,
    respondTrade,
    counterTrade,
    cancelTrade,
    vetoTrade,
    approveTrade,
    extendTrade,
    refreshTrades,
    refreshRoster,
    refreshBudget,
  } = useTrading({
    leagueId: league.id,
    teamId: team.id,
    userId,
    rosterRequested,
  })

  const retryAction = useCallback(async () => {
    await Promise.all([
      ...(error ? [refreshTrades()] : []),
      ...(budgetError ? [refreshBudget()] : []),
    ])
  }, [error, budgetError, refreshTrades, refreshBudget])
  const { execute: retry, isLoading: isRetrying } = useAsyncAction(retryAction)
  const { execute: retryComposer, isLoading: isRetryingComposer } = useAsyncAction(refreshRoster)
  const prepareTrade = useCallback(() => setRosterRequested(true), [])
  const closeProposeModal = useCallback(() => setShowProposeModal(false), [])
  const composerState: TradeComposerState = {
    isLoading: isRosterLoading || isBudgetLoading,
    error: (isRosterLoading ? rosterError : null) ?? (isBudgetLoading ? budgetError : null),
    onRetry: retryComposer,
    isRetrying: isRetryingComposer,
    onOpen: prepareTrade,
  }

  return (
    <>
      {(error || budgetError) && (
        <div className="alert alert-error mb-4" role="alert">
          <p>{error ?? budgetError}</p>
          <button onClick={retry} disabled={isRetrying} className="btn btn-secondary mt-3">
            {isRetrying ? 'Retrying...' : 'Try again'}
          </button>
        </div>
      )}
      <TradingPanel
        team={team}
        currentTeam={currentTeam}
        otherTeams={otherTeams}
        trades={trades}
        pendingTrades={pendingTrades}
        myTrades={myTrades}
        tradeableMovies={tradeableMovies}
        budget={budget}
        isLoading={isLoading}
        hasTradesError={!!error}
        isBudgetLoading={isBudgetLoading}
        budgetError={budgetError}
        composerState={composerState}
        isOwner={isOwner}
        expiryBounds={expiryBounds}
        onProposeTrade={() => {
          // A failed preload is surfaced by the lazy import's error boundary.
          void loadProposeTradeModal().catch(() => {})
          prepareTrade()
          setShowProposeModal(true)
        }}
        onRespondTrade={respondTrade}
        onCounterTrade={counterTrade}
        onCancelTrade={cancelTrade}
        onVetoTrade={vetoTrade}
        onApproveTrade={approveTrade}
        onExtendTrade={extendTrade}
      />

      {showProposeModal && (composerState.isLoading || composerState.error ? (
        <TradeComposerLoading state={composerState} onClose={closeProposeModal} />
      ) : (
        <Suspense fallback={<TradeComposerLoading state={composerState} onClose={closeProposeModal} />}>
          <ProposeTradeModal
            team={team}
            otherTeams={otherTeams}
            tradeableMovies={tradeableMovies}
            budget={budget}
            expiryBounds={expiryBounds}
            onClose={closeProposeModal}
            onPropose={async (
              recipientTeamId: string,
              offeredItems: TradeItems,
              requestedItems: TradeItems,
              message?: string,
              expiry?: ResolvedExpiry
            ) => {
              const result = await proposeTrade(recipientTeamId, offeredItems, requestedItems, message, expiry)
              if (result.success) {
                // The anchor rides along on the existing event rather than adding
                // a second one: the question it answers ("is anyone using the
                // release option?") is about proposals, not a separate action.
                trackEvent('trade_proposed', {
                  league_id: league.id,
                  expiry: expiry?.expiry_anchor ?? 'none',
                })
                closeProposeModal()
              }
              return result
            }}
          />
        </Suspense>
      ))}
    </>
  )
}
