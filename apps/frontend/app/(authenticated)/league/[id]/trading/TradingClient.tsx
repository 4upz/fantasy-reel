'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { League, Team, TradeItems } from '@/types'
import { useTrading } from '../hooks/useTrading'
import TradingPanel from '../components/TradingPanel'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const ProposeTradeModal = dynamic(() => import('../components/ProposeTradeModal'), {
  loading: () => <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/60" /><div className="relative animate-pulse h-[90vh] max-w-2xl w-full bg-surface rounded-lg" /></div>,
})

interface Props {
  league: League
  team: Team
  otherTeams: { id: string; name: string; avatar_url: string | null }[]
  isOwner: boolean
}

export default function TradingClient({ league, team, otherTeams, isOwner }: Props) {
  const [showProposeModal, setShowProposeModal] = useState(false)

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
        otherTeams={otherTeams}
        trades={trades}
        pendingTrades={pendingTrades}
        myTrades={myTrades}
        tradeableMovies={tradeableMovies}
        budget={budget}
        isOwner={isOwner}
        onProposeTrade={() => setShowProposeModal(true)}
        onRespondTrade={respondTrade}
        onCounterTrade={counterTrade}
        onCancelTrade={cancelTrade}
        onVetoTrade={vetoTrade}
      />

      {showProposeModal && (
        <ProposeTradeModal
          team={team}
          otherTeams={otherTeams}
          tradeableMovies={tradeableMovies}
          budget={budget}
          onClose={() => setShowProposeModal(false)}
          onPropose={async (recipientTeamId: string, offeredItems: TradeItems, requestedItems: TradeItems, message?: string) => {
            const result = await proposeTrade(recipientTeamId, offeredItems, requestedItems, message)
            if (result.success) {
              setShowProposeModal(false)
            }
            return result
          }}
        />
      )}
    </>
  )
}
