'use client'

import { useState } from 'react'
import { formatFantasyPoints } from '@/utils/scoring'
import type { HoldingMovie, RankedTeamFull } from '@/types'
import MovieScoreCard from './MovieScoreCard'
import TeamBudgetSummary, { remainingBudget } from './TeamBudget'
import TeamStandingSummary from './TeamStandingSummary'
import LeagueMovieModal from '../components/LeagueMovieModal'

interface Props {
  rankedTeam: RankedTeamFull
  /** The league's starting purse, or null when the league doesn't use a fantasy budget. */
  startingBudget: number | null
  isCurrentUser: boolean
  /** The season this team's owner is defending, or null when they hold no title. */
  reigningChampionSeason?: number | null
  /** Mobile only - above lg the roster lives in the detail rail instead. */
  isExpanded: boolean
  /** Desktop only - which team the detail rail is showing. */
  isSelected: boolean
  onActivate: () => void
  animationDelay?: number
}

function pointsTone(points: number): string {
  return points >= 0 ? 'text-gold' : 'text-crimson'
}

/** One segment of the points total. Value colour tells you which way it pulled. */
function BreakdownChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="type-meta rounded-lg bg-elevated px-2 py-[3px] text-foreground-secondary">
      {label} <span className={`type-numeric font-semibold ${tone}`}>{formatFantasyPoints(value)}</span>
    </span>
  )
}

export default function TeamStandingCard({
  rankedTeam,
  startingBudget,
  isCurrentUser,
  reigningChampionSeason = null,
  isExpanded,
  isSelected,
  onActivate,
  animationDelay = 0,
}: Props) {
  const [selected, setSelected] = useState<HoldingMovie | null>(null)
  const { rank, participant, draftPicks, pickups, counterpicks, isTied } = rankedTeam
  const team = participant.teams
  const teamScore = team?.team_scores
  const profile = participant.profiles

  const totalPoints = teamScore?.total_points ?? 0
  const draftPoints = teamScore?.draft_points ?? 0
  const pickupPoints = teamScore?.pickup_points ?? 0
  const counterpickPoints = teamScore?.counterpick_points ?? 0
  const moviesScored = teamScore?.movies_scored ?? 0
  const moviesPending = teamScore?.movies_pending ?? 0
  const movieCount = draftPicks.length + pickups.length
  const budgetLeft = startingBudget == null ? null : remainingBudget(team?.team_budgets, startingBudget)

  const displayName = team?.name || profile?.display_name || 'Unnamed Team'
  const ownerHandle = team?.name ? profile?.display_name : null

  const panelId = `team-movies-${team?.id}`

  // Your own team keeps a faint gold edge; the row feeding the rail is brighter
  // and tinted, so the two never read as the same state.
  return (
    <div
      className={`flex-none animate-slide-up overflow-hidden rounded-2xl border bg-surface lg:rounded-[14px] ${
        isSelected ? 'lg:border-gold lg:bg-surface-hover' : ''
      } ${isCurrentUser ? 'border-gold/35' : 'border-border'}`}
      style={{ animationDelay: `${animationDelay}ms` }}
      data-testid={`team-row-${team?.id}`}
    >
      <button
        onClick={onActivate}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex w-full flex-col gap-2.5 p-3.5 text-left transition-colors hover:bg-surface-hover lg:gap-0 lg:px-4"
      >
        <TeamStandingSummary
          rank={rank}
          isTied={isTied}
          displayName={displayName}
          ownerHandle={ownerHandle}
          avatarUrl={team?.avatar_url}
          isCurrentUser={isCurrentUser}
          reigningChampionSeason={reigningChampionSeason}
          movieCount={movieCount}
          moviesScored={moviesScored}
          moviesPending={moviesPending}
          budgetLeft={budgetLeft}
          totalPoints={totalPoints}
          isExpanded={isExpanded}
        />
      </button>

      {isExpanded && (
        <div
          id={panelId}
          className="flex animate-fade-in flex-col gap-2.5 border-t border-border px-3.5 pt-3 pb-3.5 lg:hidden"
        >
          {/* The breakdown lives here rather than in the collapsed row - it is
              detail you go looking for, not something to scan the table by. */}
          <div className="flex flex-wrap gap-1.5">
            <BreakdownChip label="Draft" value={draftPoints} tone={pointsTone(draftPoints)} />
            <BreakdownChip label="Pickups" value={pickupPoints} tone={pointsTone(pickupPoints)} />
            <BreakdownChip
              label="Counterpicks"
              value={counterpickPoints}
              tone={counterpickPoints >= 0 ? 'text-success' : 'text-crimson'}
            />
          </div>

          {startingBudget !== null && <TeamBudgetSummary budget={team?.team_budgets} startingBudget={startingBudget} />}

          {draftPicks.map((pick) => (
            <MovieScoreCard
              key={pick.id}
              movie={pick.movie}
              badge={{ type: 'draft', round: pick.round, pick: pick.pick_number }}
              isCounterpicked={!!pick.counterpicked_by_team_id}
              onSelect={setSelected}
            />
          ))}

          {pickups.map((pickup) => (
            <MovieScoreCard
              key={pickup.id}
              movie={pickup.movie}
              badge={{ type: 'pickup', amount: pickup.amount_paid }}
              onSelect={setSelected}
            />
          ))}

          {counterpicks.map((cp) => (
            <MovieScoreCard
              key={cp.id}
              movie={cp.movies}
              badge={{ type: 'counterpick', targetTeam: cp.target_team.name }}
              overridePoints={cp.fantasy_points}
              onSelect={setSelected}
            />
          ))}

          {movieCount === 0 && counterpicks.length === 0 && (
            <p className="type-body-sm py-3 text-center text-foreground-secondary">No movies drafted yet</p>
          )}
        </div>
      )}

      {/* Read-only: this is whoever's roster you are inspecting, not yours. */}
      {selected && (
        <LeagueMovieModal
          movie={selected}
          contextHeading={`On ${displayName}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
