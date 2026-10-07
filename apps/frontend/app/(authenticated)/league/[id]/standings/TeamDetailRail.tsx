'use client'

import { useState } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import { formatDate } from '@/utils/date'
import { describePreReleaseScore, formatFantasyPoints, isPreReleaseScore, pointsTone } from '@/utils/scoring'
import type { HoldingMovie, RankedTeamFull } from '@/types'
import TeamBudgetSummary from './TeamBudget'
import { standingDisplayName } from './TeamStandingCard'
import LeagueMovieModal from '../components/LeagueMovieModal'

interface Props {
  /** Referenced by the standings rows, which choose the team shown here. */
  id: string
  rankedTeam: RankedTeamFull
  /** The league's starting purse, or null when the league doesn't use a fantasy budget. */
  startingBudget: number | null
}

interface RosterEntry {
  key: string
  movie: HoldingMovie
  points: number | null
  /** The team a counterpick bets against; unset for the team's own movies. */
  counterpickTarget?: string
}

function RailPoster({ movie }: { movie: HoldingMovie }) {
  return (
    <div className="relative h-12 w-8 flex-none overflow-hidden rounded-md bg-elevated">
      <MoviePoster
        src={movie.poster_url}
        alt=""
        sizes="32px"
        posterSize="w92"
      />
    </div>
  )
}

function BreakdownTile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-background p-[9px] text-center">
      <div className={`type-number ${tone}`}>{formatFantasyPoints(value)}</div>
      <div className="type-meta mt-0.5 text-foreground-secondary">{label}</div>
    </div>
  )
}

/**
 * Desktop counterpart to the mobile accordion: instead of pushing the table
 * apart to show a roster, the selected team's detail opens beside it and stays
 * put while the list scrolls.
 */
export default function TeamDetailRail({ id, rankedTeam, startingBudget }: Props) {
  const [selected, setSelected] = useState<HoldingMovie | null>(null)
  const { participant, draftPicks, pickups, counterpicks } = rankedTeam
  const team = participant.teams
  const teamScore = team?.team_scores
  const profile = participant.profiles

  const draftPoints = teamScore?.draft_points ?? 0
  const pickupPoints = teamScore?.pickup_points ?? 0
  const counterpickPoints = teamScore?.counterpick_points ?? 0
  const moviesScored = teamScore?.movies_scored ?? 0
  const movieCount = draftPicks.length + pickups.length

  const displayName = standingDisplayName(rankedTeam)
  const ownerHandle = team?.name ? profile?.display_name : null

  const roster: RosterEntry[] = [
    ...draftPicks.map((pick) => ({ key: pick.id, movie: pick.movie, points: pick.movie.fantasy_points })),
    ...pickups.map((pickup) => ({ key: pickup.id, movie: pickup.movie, points: pickup.movie.fantasy_points })),
    ...counterpicks.map((cp) => ({
      key: cp.id,
      movie: cp.movies,
      points: cp.fantasy_points,
      counterpickTarget: cp.target_team.name,
    })),
  ]

  const subline = [ownerHandle, `${movieCount} movies`, `${moviesScored} scored`].filter((part): part is string => Boolean(part))

  return (
    <aside
      id={id}
      className="sticky top-6 hidden flex-col gap-3 rounded-2xl border border-border bg-surface p-4 lg:flex"
      aria-label={`${displayName} details`}
      data-testid="team-detail-rail"
    >
      <div>
        <h2 className="type-row-title break-words text-foreground">{displayName}</h2>
        <p className="type-meta mt-0.5 break-words text-foreground-secondary">
          {subline.map((part, index) => (
            <span key={part}>
              {index > 0 && <><span aria-hidden="true"> · </span><span className="sr-only">, </span></>}
              {part}
            </span>
          ))}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <BreakdownTile value={draftPoints} label="Draft" tone={draftPoints >= 0 ? 'text-gold' : 'text-crimson-text'} />
        <BreakdownTile value={pickupPoints} label="Pickups" tone={pickupPoints >= 0 ? 'text-gold' : 'text-crimson-text'} />
        <BreakdownTile
          value={counterpickPoints}
          label="Counter"
          tone={counterpickPoints >= 0 ? 'text-success' : 'text-crimson-text'}
        />
      </div>

      {startingBudget !== null && <TeamBudgetSummary budget={team?.team_budgets} startingBudget={startingBudget} />}

      {roster.length > 0 ? (
        <ul role="list" className="flex flex-col gap-3">
          {roster.map(({ key, movie, points, counterpickTarget }) => {
            // A bare number has no room to say it doesn't count yet, so the
            // tooltip and screen-reader text say it instead.
            const preReleaseNote = isPreReleaseScore(points, movie.release_date)
              ? describePreReleaseScore(movie.release_date)
              : undefined

            // The button's content is its name: title, date and points.
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSelected(movie)}
                  data-testid="rail-movie-button"
                  className="group flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border border-border bg-background p-[9px] text-left transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <RailPoster movie={movie} />
                  <span className="block min-w-0 flex-1">
                    <span className="type-row-title block break-words text-foreground transition-colors group-hover:text-gold">
                      <span className="sr-only">View </span>
                      {movie.title}
                    </span>
                    <span className="type-meta mt-0.5 block text-foreground-secondary">
                      {counterpickTarget && <span className="sr-only">Counterpick against {counterpickTarget}. </span>}
                      {movie.release_date ? formatDate(movie.release_date) : 'TBA'}
                    </span>
                  </span>
                  <span
                    className={`type-number flex-none ${pointsTone(points, { preRelease: Boolean(preReleaseNote), positive: 'text-gold' })}`}
                    title={preReleaseNote}
                  >
                    <span aria-hidden={points == null || undefined}>{formatFantasyPoints(points)}</span>
                    <span className="sr-only">
                      {points == null ? 'No score yet' : ` points${preReleaseNote ? `, ${preReleaseNote}` : ''}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="type-body-sm py-2 text-center text-foreground-secondary">No movies drafted yet</p>
      )}

      {/* Read-only: these are whoever's roster you are inspecting, not yours. */}
      {selected && (
        <LeagueMovieModal
          movie={selected}
          contextHeading={`On ${displayName}`}
          onClose={() => setSelected(null)}
        />
      )}
    </aside>
  )
}
