import { Trophy, Pencil } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import type { DashboardTeam } from '@/types'

interface Props {
  team: DashboardTeam
  totalTeams: number
  onEditTeam?: () => void
}

const RANK_STYLES: Record<number, { bg: string; text: string; icon: boolean }> = {
  1: { bg: 'bg-gold/20', text: 'text-gold', icon: true },
  2: { bg: 'bg-[#a8a8a8]/20', text: 'text-[#a8a8a8]', icon: true },
  3: { bg: 'bg-[#cd7f32]/20', text: 'text-[#cd7f32]', icon: true },
}

export default function TeamHeader({ team, totalTeams, onEditTeam }: Props) {
  const rankStyle = RANK_STYLES[team.rank] || { bg: 'bg-elevated', text: 'text-foreground-muted', icon: false }
  const isPositive = team.total_points >= 0

  return (
    <div className="card p-6" data-testid="team-header">
      <div className="flex items-center justify-between">
        {/* Team Name */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-display font-bold text-foreground" data-testid="team-name">
              {team.name}
            </h2>
            {onEditTeam && (
              <button
                type="button"
                onClick={onEditTeam}
                className="btn-ghost p-1.5 rounded-lg text-foreground-muted hover:text-gold transition-colors"
                aria-label="Edit team"
                data-testid="edit-team-button"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-sm text-foreground-muted mt-1">
            {team.movies.length} movies drafted
          </p>
        </div>

        {/* Rank and Points */}
        <div className="flex items-center gap-4">
          {/* Rank Badge */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${rankStyle.bg}`}>
            {rankStyle.icon && <Trophy className={`w-4 h-4 ${rankStyle.text}`} />}
            <span className={`font-display font-bold ${rankStyle.text}`}>
              #{team.rank}
            </span>
            <span className="text-xs text-foreground-muted">
              of {totalTeams}
            </span>
          </div>

          {/* Points */}
          <div className="text-right">
            <div className={`text-3xl font-display font-bold ${isPositive ? 'text-gold' : 'text-crimson'}`}>
              {formatFantasyPoints(team.total_points)}
            </div>
            <div className="text-xs text-foreground-muted uppercase tracking-wide">
              points
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
