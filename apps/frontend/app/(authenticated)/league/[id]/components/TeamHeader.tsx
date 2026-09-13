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
 * The overview's opening line: team, rank, points, and remaining Fantasy Budget.
 * Deliberately not a card - the "next up" hero below it is the thing meant to
 * catch the eye, and two stacked panels would fight over that.
 * @design-system League
 */
export default function TeamHeader({ team, totalTeams, leagueName, onEditTeam }: Props) {
  const isPositive = team.total_points >= 0

  return (
    <div className="flex items-center gap-2.5 px-4 pb-3" data-testid="team-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h2
            className="type-row-title truncate text-foreground"
            data-testid="team-name"
          >
            {team.name}
          </h2>
          {onEditTeam && (
            <button
              type="button"
              onClick={onEditTeam}
              className="flex-none rounded-md p-1 text-foreground-secondary transition-colors hover:text-gold"
              aria-label="Edit team"
              data-testid="edit-team-button"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="type-meta mt-0.5 truncate text-foreground-secondary">
          #{team.rank} of {totalTeams} · {leagueName}
        </p>
      </div>

      <div className="flex flex-none items-center gap-4 text-right sm:gap-5">
        <div data-testid="team-points">
          <div
            className={`type-number-lg ${isPositive ? 'text-gold' : 'text-crimson'}`}
          >
            {formatFantasyPoints(team.total_points)}
          </div>
          <div className="type-meta mt-0.5 text-foreground-secondary">Points</div>
        </div>
        {team.remaining_budget !== null && (
          <div className="border-l border-border pl-4 sm:pl-5" data-testid="team-budget">
            <div
              className={`type-number-lg ${team.remaining_budget > 0 ? 'text-gold' : 'text-foreground-secondary'}`}
            >
              ${team.remaining_budget}
            </div>
            <div className="type-meta mt-0.5 text-foreground-secondary">Budget</div>
          </div>
        )}
      </div>
    </div>
  )
}
