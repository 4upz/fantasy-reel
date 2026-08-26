'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { League, Team, TeamWithOwner, TradeItems } from '@/types'
import { useTrading } from '../hooks/useTrading'
import TradingPanel from '../components/TradingPanel'
import { trackEvent } from '@/utils/analytics'
import { resolveExpiryBounds, type ResolvedExpiry } from '@/utils/tradeExpiry'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const ProposeTradeModal = dynamic(() => import('../components/ProposeTradeModal'), {
  loading: () => <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/60" /><div className="relative animate-pulse h-[90vh] max-w-2xl w-full bg-surface rounded-lg" /></div>,
})

interface Props {
  league: League
  team: Team
  currentTeam: TeamWithOwner
  otherTeams: TeamWithOwner[]
  isOwner: boolean
}

export default function TradingClient({ league, team, currentTeam, otherTeams, isOwner }: Props) {
  const [showProposeModal, setShowProposeModal] = useState(false)

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
    proposeTrade,
    respondTrade,
    counterTrade,
    cancelTrade,
    vetoTrade,
    approveTrade,
    extendTrade,
  } = useTrading({
    leagueId: league.id,
    teamId: team.id,
  })

  if (isLoading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold mx-auto" />
        <p className="mt-4 text-foreground-secondary">Loading trades...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <p>{error}</p>
      </div>
    )
  }

  return (
    <>
      <TradingPanel
        team={team}
        currentTeam={currentTeam}
        otherTeams={otherTeams}
        trades={trades}
        pendingTrades={pendingTrades}
        myTrades={myTrades}
        tradeableMovies={tradeableMovies}
        budget={budget}
        isOwner={isOwner}
        expiryBounds={expiryBounds}
        onProposeTrade={() => setShowProposeModal(true)}
        onRespondTrade={respondTrade}
        onCounterTrade={counterTrade}
        onCancelTrade={cancelTrade}
        onVetoTrade={vetoTrade}
        onApproveTrade={approveTrade}
        onExtendTrade={extendTrade}
      />

      {showProposeModal && (
        <ProposeTradeModal
          team={team}
          otherTeams={otherTeams}
          tradeableMovies={tradeableMovies}
          budget={budget}
          expiryBounds={expiryBounds}
          onClose={() => setShowProposeModal(false)}
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
              setShowProposeModal(false)
            }
            return result
          }}
        />
      )}
    </>
  )
}
