'use client'

import { useState } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import type { HoldingMovie, RankedTeamFull } from '@/types'
import TeamBudgetSummary from './TeamBudget'
import LeagueMovieModal from '../components/LeagueMovieModal'

interface Props {
  rankedTeam: RankedTeamFull
  /** The league's starting purse, or null when the league doesn't use a fantasy budget. */
  startingBudget: number | null
}

interface RosterEntry {
  key: string
  movie: HoldingMovie
  points: number | null
}

function RailPoster({ movie }: { movie: HoldingMovie }) {
  return (
    <div className="relative h-12 w-8 flex-none overflow-hidden rounded-md bg-elevated">
      <MoviePoster
        src={movie.poster_url}
        alt={movie.title}
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
export default function TeamDetailRail({ rankedTeam, startingBudget }: Props) {
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

  const displayName = team?.name || profile?.display_name || 'Unnamed Team'
  const ownerHandle = team?.name ? profile?.display_name : null

  const roster: RosterEntry[] = [
    ...draftPicks.map((pick) => ({ key: pick.id, movie: pick.movie, points: pick.movie.fantasy_points })),
    ...pickups.map((pickup) => ({ key: pickup.id, movie: pickup.movie, points: pickup.movie.fantasy_points })),
    ...counterpicks.map((cp) => ({ key: cp.id, movie: cp.movies, points: cp.fantasy_points })),
  ]

  const subline = [ownerHandle, `${movieCount} movies`, `${moviesScored} scored`].filter(Boolean).join(' · ')

  return (
    <aside
      className="sticky top-6 hidden flex-col gap-3 rounded-2xl border border-border bg-surface p-4 lg:flex"
      aria-label={`${displayName} detail`}
      data-testid="team-detail-rail"
    >
      <div>
        <div className="type-row-title truncate text-foreground">{displayName}</div>
        <div className="type-meta mt-0.5 truncate text-foreground-secondary">{subline}</div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <BreakdownTile value={draftPoints} label="Draft" tone={draftPoints >= 0 ? 'text-gold' : 'text-crimson'} />
        <BreakdownTile value={pickupPoints} label="Pickups" tone={pickupPoints >= 0 ? 'text-gold' : 'text-crimson'} />
        <BreakdownTile
          value={counterpickPoints}
          label="Counter"
          tone={counterpickPoints >= 0 ? 'text-success' : 'text-crimson'}
        />
      </div>

      {startingBudget !== null && <TeamBudgetSummary budget={team?.team_budgets} startingBudget={startingBudget} />}

      {roster.length > 0 ? (
        roster.map(({ key, movie, points }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(movie)}
            aria-label={`View ${movie.title}`}
            data-testid="rail-movie-button"
            className="group flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border border-border bg-background p-[9px] text-left transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <RailPoster movie={movie} />
            <div className="min-w-0 flex-1">
              <div
                className="type-row-title truncate text-foreground transition-colors group-hover:text-gold"
                title={movie.title}
              >
                {movie.title}
              </div>
              <div className="type-meta mt-0.5 text-foreground-secondary">
                {movie.release_date ? formatDate(movie.release_date) : 'TBA'}
              </div>
            </div>
            <div
              className={`type-number flex-none ${
                points == null ? 'text-foreground-secondary' : points >= 0 ? 'text-gold' : 'text-crimson'
              }`}
            >
              {formatFantasyPoints(points)}
            </div>
          </button>
        ))
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
