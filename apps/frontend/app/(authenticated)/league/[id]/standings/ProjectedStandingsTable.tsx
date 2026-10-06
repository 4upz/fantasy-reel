'use client'

import { useState } from 'react'
import { formatFantasyPoints } from '@/utils/scoring'
import type { ProjectedStanding } from '@/utils/projectedStandings'
import TeamProjectionSheet from '../components/TeamProjectionSheet'

interface Props {
  standings: ProjectedStanding[]
  /** Owner names by team, for the line under each team name. */
  ownerNameByTeamId: ReadonlyMap<string, string | null>
  currentUserTeamId: string | null
}

const RANK_TONE: Record<number, string> = { 1: 'text-gold', 2: 'text-silver', 3: 'text-bronze' }

/** "▲1" up, "▼2" down, "–" level -- in words for a screen reader. */
function RankChange({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="type-meta font-bold text-success" aria-label={`up ${change}`}>
        ▲{change}
      </span>
    )
  }
  if (change < 0) {
    return (
      <span className="type-meta font-bold text-error" aria-label={`down ${-change}`}>
        ▼{-change}
      </span>
    )
  }
  return (
    <span className="type-meta text-foreground-secondary" aria-label="no change">
      –
    </span>
  )
}

function TossUp() {
  return (
    <span className="type-meta flex-none rounded-full bg-warning-bg px-2 font-semibold text-warning">Toss-up</span>
  )
}

/**
 * Earned points as a solid bar, what is still to come as a dashed extension
 * (gold when it adds, crimson over the part it is projected to give back).
 */
function ProjectionBar({ team, scale }: { team: ProjectedStanding; scale: number }) {
  const percent = (value: number) => `${(Math.max(0, value) / scale) * 100}%`
  const solid = Math.min(team.earned, team.projected)
  const gain = team.projected > team.earned
  return (
    <span className="relative block h-2.5 w-full rounded-sm bg-elevated" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-l-sm bg-gold" style={{ width: percent(solid) }} />
      {team.projected !== team.earned && (
        <span
          className={`absolute inset-y-0 rounded-r-sm border border-dashed border-l-0 ${gain ? 'border-gold/80 bg-gold/15' : 'border-crimson/80 bg-crimson/15'}`}
          style={{ left: percent(solid), width: percent(Math.abs(team.projected - team.earned)) }}
        />
      )}
    </span>
  )
}

/**
 * Projected standings (Beta): every team ranked as if each unreleased movie
 * lands at its most likely score. Shown beside the real table, never instead
 * of it -- rank and champions come from real points only.
 */
/** @design-system League */
export default function ProjectedStandingsTable({ standings, ownerNameByTeamId, currentUserTeamId }: Props) {
  const [openTeamId, setOpenTeamId] = useState<string | null>(null)
  const openTeam = standings.find((team) => team.team_id === openTeamId) ?? null
  const scale = Math.max(1, ...standings.map((team) => Math.max(team.earned, team.projected)))
  const toRelease = new Set(
    standings.flatMap((team) => team.legs.filter((leg) => leg.basis !== 'earned' && !leg.counterpick).map((leg) => leg.tmdb_id))
  ).size
  const anyTossUp = standings.some((team) => team.tossUp)

  return (
    <div className="flex flex-col gap-3" data-testid="projected-standings">
      <p className="type-body-sm text-foreground-secondary">
        If every unreleased movie lands at its most likely score. {toRelease} {toRelease === 1 ? 'movie' : 'movies'} still
        to release. Tap a team to see how it adds up.
      </p>

      <div className="card p-2 sm:p-3">
        <div
          className="type-meta hidden grid-cols-[3.5rem_minmax(0,1.3fr)_minmax(0,1.6fr)_4.5rem_3.5rem_3.5rem] gap-x-4 border-b border-border px-3 pb-2 pt-1 text-foreground-secondary sm:grid"
          aria-hidden="true"
        >
          <span>Proj.</span>
          <span>Team</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2.5 rounded-sm bg-gold" />
              Earned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2.5 rounded-sm border border-dashed border-gold bg-gold/15" />
              Projected
            </span>
          </span>
          <span className="text-right">Proj. pts</span>
          <span className="text-right">Now</span>
          <span className="text-right">Left</span>
        </div>

        <ol className="mt-1 flex flex-col gap-1">
          {standings.map((team) => {
            const own = team.team_id === currentUserTeamId
            const owner = ownerNameByTeamId.get(team.team_id)
            const rankTone = RANK_TONE[team.projectedRank] ?? 'text-foreground-secondary'
            return (
              <li key={team.team_id}>
                <button
                  type="button"
                  onClick={() => setOpenTeamId(team.team_id)}
                  aria-haspopup="dialog"
                  aria-label={`${team.team_name}: projected ${team.isTied ? 'tied ' : ''}${team.projectedRank}, about ${formatFantasyPoints(team.projected)} points. See how it adds up`}
                  data-testid={`projected-row-${team.team_id}`}
                  className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border px-2 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:grid-cols-[3.5rem_minmax(0,1.3fr)_minmax(0,1.6fr)_4.5rem_3.5rem_3.5rem] sm:gap-x-4 sm:px-3 ${
                    own ? 'border-gold/30 bg-gold/[0.08]' : 'border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`type-number ${rankTone}`}>
                      {team.isTied ? 'T' : ''}
                      {team.projectedRank}
                    </span>
                    <RankChange change={team.rankChange} />
                  </span>

                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`type-row-title truncate ${own ? 'text-gold' : 'text-foreground'}`}>{team.team_name}</span>
                      {team.tossUp && <TossUp />}
                    </span>
                    {owner && <span className="type-meta block truncate text-foreground-secondary">{owner}</span>}
                    <span className="type-meta block text-foreground-secondary sm:hidden">
                      Now {formatFantasyPoints(team.earned)} · {team.remaining} left
                    </span>
                  </span>

                  <span className="hidden sm:block">
                    <ProjectionBar team={team} scale={scale} />
                  </span>

                  <span className="type-number text-right text-lg text-foreground underline decoration-foreground-muted decoration-dotted underline-offset-4">
                    {formatFantasyPoints(team.projected)}
                  </span>
                  <span className="type-numeric type-label hidden text-right text-foreground-secondary sm:block">
                    {formatFantasyPoints(team.earned)}
                  </span>
                  <span className="type-numeric type-label hidden text-right text-foreground-secondary sm:block">
                    {team.remaining}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <p className="type-meta text-foreground-secondary">
        {anyTossUp && "Toss-up: the gap is smaller than the uncertainty in what's left. "}
        Rank and champions still come from real points only.
      </p>

      {openTeam && <TeamProjectionSheet team={openTeam} standings={standings} onClose={() => setOpenTeamId(null)} />}
    </div>
  )
}
