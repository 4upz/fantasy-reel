import TeamStandingSummary from '../../(authenticated)/league/[id]/standings/TeamStandingSummary'

/** Fixed example data in the same display component as the league standings. */
export default function StandingsPreviewScene() {
  return (
    <div className="bg-background p-6 text-left" style={{ width: 800, height: 280 }}>
      <div className="mb-5 flex items-center justify-between">
        <h3 className="type-section text-foreground">Standings</h3>
        <span className="type-meta text-foreground-secondary">Example league</span>
      </div>
      <div className="space-y-3">
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
          <TeamStandingSummary
            rank={1}
            isTied={false}
            displayName="Classic Cinema"
            ownerHandle="Carol"
            isCurrentUser={false}
            movieCount={5}
            moviesScored={4}
            moviesPending={1}
            budgetLeft={72}
            totalPoints={122}
            inline
            scoreFocus="score"
            budgetFocus="budget"
          />
        </div>
        <div className="rounded-[14px] border border-gold/35 bg-surface px-4 py-3.5">
          <TeamStandingSummary
            rank={2}
            isTied={false}
            displayName="Vintage Vibes"
            ownerHandle="Alice"
            isCurrentUser
            movieCount={5}
            moviesScored={4}
            moviesPending={1}
            budgetLeft={85}
            totalPoints={104}
            inline
          />
        </div>
      </div>
    </div>
  )
}
