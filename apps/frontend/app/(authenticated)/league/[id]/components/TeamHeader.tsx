import { Trophy } from 'lucide-react'
import type { DashboardTeam } from '@/types'

interface Props {
  team: DashboardTeam
  totalTeams: number
}

const RANK_STYLES: Record<number, { bg: string; text: string; icon: boolean }> = {
  1: { bg: 'bg-gold/20', text: 'text-gold', icon: true },
  2: { bg: 'bg-[#a8a8a8]/20', text: 'text-[#a8a8a8]', icon: true },
  3: { bg: 'bg-[#cd7f32]/20', text: 'text-[#cd7f32]', icon: true },
}

export default function TeamHeader({ team, totalTeams }: Props) {
  const rankStyle = RANK_STYLES[team.rank] || { bg: 'bg-elevated', text: 'text-foreground-muted', icon: false }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        {/* Team Name */}
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">
            {team.name}
          </h2>
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
            <div className="text-3xl font-display font-bold text-gold">
              {team.total_points}
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
