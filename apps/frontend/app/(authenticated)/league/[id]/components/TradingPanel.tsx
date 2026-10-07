'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { announce } from '@/utils/announce'
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
import type { TradeComposerState } from './TradeComposerLoading'

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
  isLoading: boolean
  hasTradesError: boolean
  isBudgetLoading: boolean
  budgetError: string | null
  composerState: TradeComposerState
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

/** A card action that finished: what to say, and which card to return focus to. */
interface SettledAction {
  tradeId: string
  message: string
}

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
  isLoading,
  hasTradesError,
  isBudgetLoading,
  budgetError,
  composerState,
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelRef = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState<SettledAction | null>(null)

  const handleActionSettled = useCallback((tradeId: string, message: string) => {
    setSettled({ tradeId, message })
  }, [])

  // After a card action: say what happened, once, and -- when the action took
  // the focused button away (or the whole card left this tab) -- put focus on
  // the card if it is still here, else on the list, never on <body>. Runs after
  // the commit that closed any confirm dialog, so the message is not spoken
  // into a dialog that is about to disappear.
  useEffect(() => {
    if (!settled) return
    announce(settled.message)
    const active = document.activeElement
    if (active && active !== document.body) return
    const card = panelRef.current?.querySelector<HTMLElement>(`[data-trade-id="${settled.tradeId}"]`)
    ;(card ?? panelRef.current)?.focus()
  }, [settled])

  // Filter trades based on active tab
  const getFilteredTrades = () => {
    switch (activeTab) {
      case 'pending':
      case 'all':
        return pendingTrades
      case 'my-trades':
        return myTrades.filter(
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

  // The tab pattern's keyboard model: one Tab stop, arrows move and select.
  function handleTabKeyDown(event: React.KeyboardEvent, index: number): void {
    const last = tabs.length - 1
    const nextIndex =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
          : event.key === 'Home' ? 0
            : event.key === 'End' ? last
              : null
    if (nextIndex === null) return
    event.preventDefault()
    setActiveTab(tabs[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className="space-y-4" role="region" aria-label="Trading block" data-testid="trading-panel">
      {/* Header */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="type-section text-foreground">Trading block</h2>
            <p className="type-body-sm text-foreground-secondary mt-1">
              Trade movies and budget with other teams
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Not a live region: new offers are announced as they arrive (useTrading). */}
            {!isLoading && actionNeededCount > 0 && (
              <span className="type-label text-crimson-text">
                {actionNeededCount} {actionNeededCount === 1 ? 'trade needs' : 'trades need'} your response
              </span>
            )}
            <button
              type="button"
              onClick={onProposeTrade}
              className="btn btn-primary"
              data-testid="propose-trade-button"
            >
              Propose trade
            </button>
          </div>
        </div>

        {/* Budget display */}
        <div className="mt-4 pt-4 border-t border-border">
          <p className="type-body-sm text-foreground-secondary">
            Available budget: {budget ? (
              <span className="type-number text-gold">${budget.remaining_budget}</span>
            ) : isBudgetLoading && !budgetError ? (
              <span className="inline-block h-5 w-14 skeleton rounded align-middle" role="status" aria-label="Loading budget">
                <span className="sr-only">Loading budget</span>
              </span>
            ) : (
              <span>Unavailable</span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="border-b border-border">
          <div
            className="flex gap-1 px-4 overflow-x-auto"
            role="tablist"
            aria-label="Trade categories"
          >
            {tabs.map((tab, index) => {
              const isSelected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[index] = node }}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  role="tab"
                  aria-selected={isSelected}
                  // Only the selected tab's panel is rendered.
                  aria-controls={isSelected ? `trade-panel-${tab.id}` : undefined}
                  tabIndex={isSelected ? 0 : -1}
                  id={`trade-tab-${tab.id}`}
                  className={`type-control px-4 py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 cursor-pointer ${
                    isSelected
                      ? 'text-gold border-gold'
                      : 'text-foreground-secondary hover:text-foreground border-transparent'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && isLoading ? (
                    <span className="h-5 w-5 skeleton rounded-full" aria-hidden="true" />
                  ) : tab.count !== undefined && tab.count > 0 && (
                    <span className="type-meta type-numeric bg-surface-hover text-foreground-secondary px-1.5 py-0.5 rounded-full">
                      {tab.count}
                      <span className="sr-only"> trades</span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Trade list */}
        <div
          ref={panelRef}
          className="p-4"
          role="tabpanel"
          id={`trade-panel-${activeTab}`}
          aria-labelledby={`trade-tab-${activeTab}`}
          aria-busy={isLoading && !hasTradesError}
          // A focus target for when an action removes the card that had focus.
          tabIndex={-1}
        >
          {isLoading && hasTradesError ? null : isLoading ? (
            <div className="space-y-4" role="status" aria-label="Loading trades" data-testid="trading-loading">
              <span className="sr-only">Loading trades...</span>
              {[0, 1].map((index) => (
                <div key={index} className="rounded-lg border border-border p-4 space-y-4" aria-hidden="true">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 skeleton rounded-full" />
                    <div className="h-5 w-36 skeleton rounded" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="h-20 skeleton rounded" />
                    <div className="h-20 skeleton rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredTrades.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-secondary" role="status">
                {activeTab === 'pending' && 'No pending trades'}
                {activeTab === 'my-trades' && 'You have no active trades'}
                {activeTab === 'all' && 'No active trades in this league'}
                {activeTab === 'history' && 'No trade history yet'}
              </p>
            </div>
          ) : (
            // Deliberately not a live region: it would read whole cards on every
            // tab switch, realtime refetch and countdown tick. Changes are
            // announced one line at a time instead (useTrading, onActionSettled).
            <ul role="list" className="space-y-4">
              {filteredTrades.map((trade) => (
                <li key={trade.id}>
                  <TradeOfferCard
                    trade={trade}
                    currentTeamId={team.id}
                    currentTeam={currentTeam}
                    isOwner={isOwner}
                    otherTeams={otherTeams}
                    tradeableMovies={tradeableMovies}
                    budget={budget}
                    composerState={composerState}
                    expiryBounds={expiryBounds}
                    onRespond={onRespondTrade}
                    onCounter={onCounterTrade}
                    onCancel={onCancelTrade}
                    onVeto={onVetoTrade}
                    onApprove={onApproveTrade}
                    onExtend={onExtendTrade}
                    onActionSettled={handleActionSettled}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
