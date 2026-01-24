'use client'

import { useState } from 'react'
import type { League, Team } from '@/types'
import { useTrading } from '../hooks/useTrading'
import TradingPanel from '../components/TradingPanel'
import ProposeTradeModal from '../components/ProposeTradeModal'

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
          onPropose={async (recipientTeamId, offeredItems, requestedItems, message) => {
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
