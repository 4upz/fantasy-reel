'use client'

import { useState } from 'react'
import { formatFantasyPoints, pointsTone } from '@/utils/scoring'
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
  /** Above lg the row selects the rail's team instead of expanding in place. */
  isDesktop: boolean
  /** The detail rail's id, which the row controls above lg. */
  railId: string
  onActivate: () => void
  animationDelay?: number
}

/** The name a standings row goes by: the team's, else its owner's. */
export function standingDisplayName(rankedTeam: RankedTeamFull): string {
  const { participant } = rankedTeam
  return participant.teams?.name || participant.profiles?.display_name || 'Unnamed Team'
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
  isDesktop,
  railId,
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

  const displayName = standingDisplayName(rankedTeam)
  const ownerHandle = team?.name ? profile?.display_name : null

  const panelId = `team-movies-${team?.id}`

  // Below lg the row is a disclosure for the roster under it. Above lg it
  // picks the team the detail rail shows, so "expanded" would promise a panel
  // that never opens. Nor is it a toggle: activating the selected row keeps it
  // selected, so the rail's team is marked as the current one of the set.
  const rowState = isDesktop
    ? { 'aria-current': isSelected || undefined, 'aria-controls': railId }
    : { 'aria-expanded': isExpanded, 'aria-controls': panelId }

  // Your own team keeps a faint gold edge; the row feeding the rail is brighter
  // and tinted, so the two never read as the same state.
  return (
    <li
      className={`relative flex-none animate-slide-up overflow-hidden rounded-2xl border bg-surface lg:rounded-[14px] ${
        isSelected ? 'lg:border-gold lg:bg-surface-hover' : ''
      } ${isCurrentUser ? 'border-gold/35' : 'border-border'}`}
      style={{ animationDelay: `${animationDelay}ms` }}
      data-testid={`team-row-${team?.id}`}
    >
      {/* Marks the rail's team by shape as well as colour. */}
      {isSelected && (
        <span className="absolute inset-y-3 left-0 hidden w-1 rounded-r-full bg-gold lg:block" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={onActivate}
        {...rowState}
        className="flex w-full cursor-pointer flex-col gap-2.5 p-3.5 text-left transition-colors hover:bg-surface-hover lg:gap-0 lg:px-4"
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

      {/* Always rendered, so the button's aria-controls points at something. */}
      <div
        id={panelId}
        role="region"
        aria-label={`${displayName} roster`}
        hidden={!isExpanded}
        className="flex animate-fade-in flex-col gap-2.5 border-t border-border px-3.5 pt-3 pb-3.5 lg:hidden"
      >
        {isExpanded && (
          <>
            {/* The breakdown lives here rather than in the collapsed row - it is
                detail you go looking for, not something to scan the table by. */}
            <div className="flex flex-wrap gap-1.5">
              <BreakdownChip label="Draft" value={draftPoints} tone={pointsTone(draftPoints, { positive: 'text-gold' })} />
              <BreakdownChip label="Pickups" value={pickupPoints} tone={pointsTone(pickupPoints, { positive: 'text-gold' })} />
              <BreakdownChip
                label="Counterpicks"
                value={counterpickPoints}
                tone={counterpickPoints >= 0 ? 'text-success' : 'text-crimson-text'}
              />
            </div>

            {startingBudget !== null && <TeamBudgetSummary budget={team?.team_budgets} startingBudget={startingBudget} />}

            {movieCount + counterpicks.length > 0 ? (
              <ul role="list" className="flex flex-col gap-2.5">
                {draftPicks.map((pick) => (
                  <li key={pick.id} className="flex flex-col">
                    <MovieScoreCard
                      movie={pick.movie}
                      badge={{ type: 'draft', round: pick.round, pick: pick.pick_number }}
                      isCounterpicked={!!pick.counterpicked_by_team_id}
                      onSelect={setSelected}
                    />
                  </li>
                ))}

                {pickups.map((pickup) => (
                  <li key={pickup.id} className="flex flex-col">
                    <MovieScoreCard
                      movie={pickup.movie}
                      badge={{ type: 'pickup', amount: pickup.amount_paid }}
                      onSelect={setSelected}
                    />
                  </li>
                ))}

                {counterpicks.map((cp) => (
                  <li key={cp.id} className="flex flex-col">
                    <MovieScoreCard
                      movie={cp.movies}
                      badge={{ type: 'counterpick', targetTeam: cp.target_team.name }}
                      overridePoints={cp.fantasy_points}
                      onSelect={setSelected}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-body-sm py-3 text-center text-foreground-secondary">No movies drafted yet</p>
            )}
          </>
        )}
      </div>

      {/* Read-only: this is whoever's roster you are inspecting, not yours. */}
      {selected && (
        <LeagueMovieModal
          movie={selected}
          contextHeading={`On ${displayName}`}
          onClose={() => setSelected(null)}
        />
      )}
    </li>
  )
}
