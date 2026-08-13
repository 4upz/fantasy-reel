'use client'

import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { useBidHistory } from '../hooks/useBidHistory'
import { useBiddingContext } from '../bidding/BiddingContext'
import { formatRoundDate } from './bidHistory'
import BidResultCard from './BidResultCard'

/** Rounds revealed per step, so a long season doesn't land as one wall. */
const ROUNDS_PER_PAGE = 5

export default function BidHistoryPanel(): React.ReactElement {
  const { league, teamId, teams } = useBiddingContext()
  const { rounds, loading, error } = useBidHistory({ leagueId: league.id })
  const [visibleRounds, setVisibleRounds] = useState(ROUNDS_PER_PAGE)

  const teamsById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams]
  )

  if (loading) {
    return (
      <div className="card p-8 text-center" data-testid="bid-history-panel">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gold mx-auto" />
        <p className="mt-4 text-foreground-secondary">Loading results...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error" data-testid="bid-history-panel">
        <p>Couldn&apos;t load bid history: {error}</p>
      </div>
    )
  }

  if (rounds.length === 0) {
    return (
      <div className="card p-10 text-center animate-fade-in" data-testid="bid-history-panel">
        <div className="w-16 h-16 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-5">
          <History className="w-8 h-8 text-foreground-muted" aria-hidden="true" />
        </div>
        <h3 className="font-display font-bold text-xl text-foreground mb-2">
          No Results Yet
        </h3>
        <p className="text-foreground-secondary max-w-md mx-auto">
          Bids settle once a week. After the next round processes, this is where you&apos;ll
          see who won each movie, what they paid, and who they outbid.
        </p>
      </div>
    )
  }

  const shown = rounds.slice(0, visibleRounds)

  return (
    <div className="space-y-8 animate-fade-in" data-testid="bid-history-panel">
      {shown.map((round) => (
        <section key={round.date} aria-label={`Results from ${formatRoundDate(round.date)}`}>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="font-display text-xs sm:text-sm uppercase tracking-[0.15em] text-foreground-secondary whitespace-nowrap">
              {formatRoundDate(round.date)}
            </h2>
            <div className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          <div className="space-y-3">
            {round.results.map((result) => (
              <BidResultCard
                key={result.id}
                result={result}
                teamsById={teamsById}
                currentTeamId={teamId}
              />
            ))}
          </div>
        </section>
      ))}

      {rounds.length > visibleRounds && (
        <button
          onClick={() => setVisibleRounds((count) => count + ROUNDS_PER_PAGE)}
          className="btn btn-ghost w-full py-3"
        >
          Show earlier rounds
        </button>
      )}
    </div>
  )
}
