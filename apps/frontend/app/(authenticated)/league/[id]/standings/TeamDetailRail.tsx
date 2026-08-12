'use client'

import { useState } from 'react'
import Image from 'next/image'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import type { MovieWithScores, RankedTeamFull } from '@/types'
import TeamFaab from './TeamFaab'

interface Props {
  rankedTeam: RankedTeamFull
  /** The league's starting purse, or null when the league doesn't use FAAB. */
  startingFaab: number | null
}

interface RosterEntry {
  key: string
  movie: MovieWithScores
  points: number | null
}

function RailPoster({ movie }: { movie: MovieWithScores }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative h-12 w-8 flex-none overflow-hidden rounded-md bg-elevated">
      {movie.poster_url && !failed ? (
        <Image
          src={movie.poster_url}
          alt={movie.title}
          fill
          sizes="32px"
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  )
}

function BreakdownTile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-background p-[9px] text-center">
      <div className={`font-display text-[15px] font-bold ${tone}`}>{formatFantasyPoints(value)}</div>
      <div className="mt-0.5 text-[10px] text-foreground-muted">{label}</div>
    </div>
  )
}

/**
 * Desktop counterpart to the mobile accordion: instead of pushing the table
 * apart to show a roster, the selected team's detail opens beside it and stays
 * put while the list scrolls.
 */
export default function TeamDetailRail({ rankedTeam, startingFaab }: Props) {
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
    ...draftPicks.map((pick) => ({ key: pick.id, movie: pick.movies, points: pick.movies.fantasy_points })),
    ...pickups.map((pickup) => ({ key: pickup.id, movie: pickup.movies, points: pickup.movies.fantasy_points })),
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
        <div className="truncate font-display text-[15px] font-semibold text-foreground">{displayName}</div>
        <div className="mt-0.5 truncate text-xs text-foreground-muted">{subline}</div>
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

      {startingFaab !== null && <TeamFaab budget={team?.team_budgets} startingFaab={startingFaab} />}

      {roster.length > 0 ? (
        roster.map(({ key, movie, points }) => (
          <div
            key={key}
            className="flex items-center gap-2.5 rounded-[11px] border border-border bg-background p-[9px]"
          >
            <RailPoster movie={movie} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-foreground" title={movie.title}>
                {movie.title}
              </div>
              <div className="mt-0.5 text-[11px] text-foreground-muted">
                {movie.release_date ? formatDate(movie.release_date) : 'TBA'}
              </div>
            </div>
            <div
              className={`flex-none font-display text-base font-bold ${
                points == null ? 'text-foreground-muted' : points >= 0 ? 'text-gold' : 'text-crimson'
              }`}
            >
              {formatFantasyPoints(points)}
            </div>
          </div>
        ))
      ) : (
        <p className="py-2 text-center text-[13px] text-foreground-muted">No movies drafted yet</p>
      )}
    </aside>
  )
}
