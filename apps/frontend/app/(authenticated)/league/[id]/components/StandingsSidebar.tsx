import Link from 'next/link'
import type { StandingEntry } from '@/types'

interface Props {
  leagueId: string
  standings: StandingEntry[]
}

const RANK_COLORS: Record<number, string> = {
  1: 'text-gold',
  2: 'text-[#a8a8a8]',
  3: 'text-[#cd7f32]',
}

function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

export default function StandingsSidebar({ leagueId, standings }: Props) {
  if (standings.length === 0) {
    return (
      <div className="card p-4">
        <h3 className="font-display font-semibold text-foreground mb-4">Standings</h3>
        <p className="text-sm text-foreground-muted">
          Standings will appear once the draft is complete.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <h3 className="font-display font-semibold text-foreground mb-4">Standings</h3>

      <div className="space-y-3">
        {standings.map((entry) => {
          const isPositive = entry.total_points >= 0
          return (
            <div
              key={entry.team.id}
              className={`p-3 rounded-lg transition-colors ${
                entry.isCurrentUser
                  ? 'bg-gold-muted border border-gold/30'
                  : 'bg-elevated/50'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Rank */}
                <div className={`font-display font-bold text-lg w-6 ${RANK_COLORS[entry.rank] || 'text-foreground-muted'}`}>
                  {entry.isTied ? `T${entry.rank}` : entry.rank}
                </div>

                {/* Team Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium truncate ${entry.isCurrentUser ? 'text-gold' : 'text-foreground'}`}>
                      {entry.team.name}
                    </span>
                    {entry.isCurrentUser && (
                      <span className="text-gold text-xs">★</span>
                    )}
                  </div>
                  {entry.topMovie && (
                    <p className="text-xs text-foreground-muted truncate mt-0.5">
                      Top: {entry.topMovie.title} ({entry.topMovie.score >= 0 ? '+' : ''}{entry.topMovie.score}pts)
                    </p>
                  )}
                </div>

                {/* Points */}
                <div className="text-right">
                  <span className={`font-display font-bold ${isPositive ? 'text-foreground' : 'text-crimson'}`}>
                    {formatFantasyPoints(entry.total_points)}
                  </span>
                  <span className="text-xs text-foreground-muted ml-1">pts</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Link
        href={`/league/${leagueId}/standings`}
        className="mt-4 block text-center text-sm text-gold hover:text-gold-hover transition-colors"
      >
        View Full Standings →
      </Link>
    </div>
  )
}
