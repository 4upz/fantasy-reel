import { Pencil } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import type { DashboardTeam } from '@/types'

interface Props {
  team: DashboardTeam
  totalTeams: number
  leagueName: string
  onEditTeam?: () => void
}

/**
 * The overview's opening line: who you are, where you sit, what you have scored.
 * Deliberately not a card - the "next up" hero below it is the thing meant to
 * catch the eye, and two stacked panels would fight over that.
 */
export default function TeamHeader({ team, totalTeams, leagueName, onEditTeam }: Props) {
  const isPositive = team.total_points >= 0

  return (
    <div className="flex items-center gap-2.5 px-4 pb-3" data-testid="team-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h2
            className="truncate font-display text-lg font-semibold text-foreground"
            data-testid="team-name"
          >
            {team.name}
          </h2>
          {onEditTeam && (
            <button
              type="button"
              onClick={onEditTeam}
              className="flex-none rounded-md p-1 text-foreground-muted transition-colors hover:text-gold"
              aria-label="Edit team"
              data-testid="edit-team-button"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-foreground-muted">
          #{team.rank} of {totalTeams} · {leagueName}
        </p>
      </div>

      <div className="flex-none text-right">
        <div
          className={`font-display text-[30px] font-bold leading-none ${isPositive ? 'text-gold' : 'text-crimson'}`}
        >
          {formatFantasyPoints(team.total_points)}
        </div>
        <div className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-foreground-muted">Points</div>
      </div>
    </div>
  )
}
