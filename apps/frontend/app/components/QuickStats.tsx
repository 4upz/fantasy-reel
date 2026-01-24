'use client'

interface Props {
  leagueCount: number
  moviesDrafted?: number
  totalPoints?: number
}

export default function QuickStats({
  leagueCount,
  moviesDrafted = 0,
  totalPoints = 0,
}: Props): React.ReactElement {
  return (
    <div className="stats-widget">
      <h4 className="font-display font-semibold text-foreground-secondary text-sm uppercase tracking-wide mb-3">
        Quick Stats
      </h4>
      <div className="space-y-0">
        <div className="stat-item">
          <span className="text-foreground-secondary text-sm">Active Leagues</span>
          <span className="stat-value">{leagueCount}</span>
        </div>
        {moviesDrafted > 0 && (
          <div className="stat-item">
            <span className="text-foreground-secondary text-sm">Movies Drafted</span>
            <span className="stat-value">{moviesDrafted}</span>
          </div>
        )}
        {totalPoints > 0 && (
          <div className="stat-item">
            <span className="text-foreground-secondary text-sm">Total Points</span>
            <span className="stat-value">{totalPoints.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}
