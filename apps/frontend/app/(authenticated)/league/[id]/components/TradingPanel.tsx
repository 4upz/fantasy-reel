'use client'

import { useState } from 'react'
import type {
  Team,
  TeamWithOwner,
  TradeOfferWithTeams,
  TradeableMovie,
  TeamBudget,
  TradeItems,
} from '@/types'
import type { ExpiryBounds } from '@/utils/tradeExpiry'
import TradeOfferCard from './TradeOfferCard'

interface Props {
  team: Team
  currentTeam: TeamWithOwner
  otherTeams: TeamWithOwner[]
  trades: TradeOfferWithTeams[]
  pendingTrades: TradeOfferWithTeams[]
  myTrades: TradeOfferWithTeams[]
  tradeableMovies: TradeableMovie[]
  budget: TeamBudget | null
  isOwner: boolean
  /** The league's offer-window rules, on their way to each card's modals. */
  expiryBounds: ExpiryBounds
  onProposeTrade: () => void
  onRespondTrade: (
    tradeOfferId: string,
    response: 'accept' | 'reject',
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  onCounterTrade: (
    tradeOfferId: string,
    counterOfferedItems: TradeItems,
    counterRequestedItems: TradeItems,
    message?: string
  ) => Promise<{ success: boolean; error?: string }>
  onCancelTrade: (tradeOfferId: string) => Promise<{ success: boolean; error?: string }>
  onVetoTrade: (
    tradeOfferId: string,
    reason?: string
  ) => Promise<{ success: boolean; error?: string }>
  onApproveTrade: (tradeOfferId: string) => Promise<{ success: boolean; error?: string }>
  /** Proposer: push their own offer's clock out. Forward only. */
  onExtendTrade: (
    tradeOfferId: string,
    expiresAt: string
  ) => Promise<{ success: boolean; error?: string }>
}

type TabType = 'pending' | 'my-trades' | 'all' | 'history'

export default function TradingPanel({
  team,
  currentTeam,
  otherTeams,
  trades,
  pendingTrades,
  myTrades,
  tradeableMovies,
  budget,
  isOwner,
  expiryBounds,
  onProposeTrade,
  onRespondTrade,
  onCounterTrade,
  onCancelTrade,
  onVetoTrade,
  onApproveTrade,
  onExtendTrade,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('pending')

  // Filter trades based on active tab
  const getFilteredTrades = () => {
    switch (activeTab) {
      case 'pending':
        return pendingTrades
      case 'my-trades':
        return myTrades.filter(
          (t) => t.status === 'proposed' || t.status === 'countered' || t.status === 'review'
        )
      case 'all':
        return trades.filter(
          (t) => t.status === 'proposed' || t.status === 'countered' || t.status === 'review'
        )
      case 'history':
        return trades.filter(
          (t) =>
            t.status === 'completed' ||
            t.status === 'rejected' ||
            t.status === 'cancelled' ||
            t.status === 'vetoed' ||
            t.status === 'expired'
        )
      default:
        return []
    }
  }

  const filteredTrades = getFilteredTrades()

  // Count trades needing action (you're the recipient and it's proposed/countered)
  const actionNeededCount = pendingTrades.filter(
    (t) => t.recipient_team_id === team.id && (t.status === 'proposed' || t.status === 'countered')
  ).length

  const tabs: { id: TabType; label: string; count?: number }[] = [
    { id: 'pending', label: 'Pending', count: pendingTrades.length },
    { id: 'my-trades', label: 'My Trades' },
    { id: 'all', label: 'All Active' },
    { id: 'history', label: 'History' },
  ]

  return (
    <div className="space-y-4" role="region" aria-label="Trading Block" data-testid="trading-panel">
      {/* Header */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">Trading Block</h2>
            <p className="text-sm text-foreground-secondary mt-1">
              Trade movies and budget with other teams
            </p>
          </div>

          <div className="flex items-center gap-4">
            {actionNeededCount > 0 && (
              <span className="text-sm text-crimson font-medium" role="status" aria-live="polite">
                {actionNeededCount} trade{actionNeededCount !== 1 ? 's' : ''} need your response
              </span>
            )}
            <button
              onClick={onProposeTrade}
              className="btn btn-primary"
              aria-label="Propose a new trade"
              data-testid="propose-trade-button"
            >
              Propose Trade
            </button>
          </div>
        </div>

        {/* Budget display */}
        {budget && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-sm text-foreground-secondary">
              Available Budget: <span className="text-gold font-medium" aria-label={`${budget.remaining_budget} dollars`}>${budget.remaining_budget}</span>
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="border-b border-border">
          <nav
            className="flex gap-1 px-4 overflow-x-auto"
            role="tablist"
            aria-label="Trade categories"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`trade-panel-${tab.id}`}
                id={`trade-tab-${tab.id}`}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-gold border-gold'
                    : 'text-foreground-secondary hover:text-foreground border-transparent'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className="bg-surface-hover text-foreground-secondary text-xs px-1.5 py-0.5 rounded-full"
                    aria-label={`${tab.count} ${tab.label.toLowerCase()}`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Trade list */}
        <div
          className="p-4"
          role="tabpanel"
          id={`trade-panel-${activeTab}`}
          aria-labelledby={`trade-tab-${activeTab}`}
        >
          {filteredTrades.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted" role="status">
                {activeTab === 'pending' && 'No pending trades'}
                {activeTab === 'my-trades' && 'You have no active trades'}
                {activeTab === 'all' && 'No active trades in this league'}
                {activeTab === 'history' && 'No trade history yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-4" aria-live="polite">
              {filteredTrades.map((trade) => (
                <TradeOfferCard
                  key={trade.id}
                  trade={trade}
                  currentTeamId={team.id}
                  currentTeam={currentTeam}
                  isOwner={isOwner}
                  otherTeams={otherTeams}
                  tradeableMovies={tradeableMovies}
                  budget={budget}
                  expiryBounds={expiryBounds}
                  onRespond={onRespondTrade}
                  onCounter={onCounterTrade}
                  onCancel={onCancelTrade}
                  onVeto={onVetoTrade}
                  onApprove={onApproveTrade}
                  onExtend={onExtendTrade}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
