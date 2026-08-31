import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import { SEASON_YEAR_CLASS } from '@/utils/seasons'

export interface SeasonHistoryRow {
  leagueId: string
  seasonYear: number
  isCompleted: boolean
  /** Every team at rank 1. More than one means the title was shared. */
  champions: string[]
  championPoints: number | null
  /** The two teams behind the champion, carrying their real ranks. */
  runnersUp: { rank: number; name: string }[]
  /** The season being viewed, marked so the list says where you are. */
  isCurrent: boolean
}

interface Props {
  rows: SeasonHistoryRow[]
}

/**
 * "2nd", "3rd", "4th". Ranks are printed rather than positions because a shared
 * first place pushes the next team to 3rd, and saying "2nd" there would be a
 * different claim than the standings make.
 */
function ordinal(rank: number): string {
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'
  return `${rank}${suffix}`
}

/**
 * A series, one row per season, newest first.
 *
 * The years run down a hairline spine on the left - the film-can label
 * repeating down the page. That is the only ornament: the list grows by one row
 * a year forever, so it has to stay readable at fifteen rows, not just three.
 */
export default function SeasonHistoryList({ rows }: Props): React.ReactElement {
  return (
    <ol className="space-y-2.5" data-testid="season-history-list">
      {rows.map((row) => (
        <li key={row.leagueId}>
          <Link
            href={`/league/${row.leagueId}/standings`}
            className="card card-interactive group block p-4"
          >
            <div className="flex gap-4">
              <div className="flex-none border-l border-border pl-3">
                <span className={`text-sm text-foreground-secondary ${SEASON_YEAR_CLASS}`}>
                  {row.seasonYear}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {row.champions.length > 0 ? (
                    <>
                      <Trophy
                        className="h-3.5 w-3.5 flex-none translate-y-0.5 text-gold"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-display font-semibold text-gold">
                        {row.champions.join(' · ')}
                      </span>
                      <span className="flex-none font-display text-sm font-semibold text-foreground-secondary">
                        {formatFantasyPoints(row.championPoints)}
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-foreground-muted">
                      {row.isCurrent ? 'This season, still being played' : 'Still being played'}
                    </span>
                  )}

                  <span
                    className={`badge flex-none ${row.isCompleted ? 'badge-completed' : 'badge-active'}`}
                  >
                    {row.isCompleted ? 'Completed' : 'In progress'}
                  </span>
                </div>

                {row.runnersUp.length > 0 && (
                  <p className="mt-1 truncate text-xs text-foreground-muted">
                    {row.runnersUp.map((team) => `${ordinal(team.rank)} ${team.name}`).join(' · ')}
                  </p>
                )}

                <p className="mt-1.5 text-xs text-foreground-muted transition-colors group-hover:text-gold">
                  View season →
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  )
}
