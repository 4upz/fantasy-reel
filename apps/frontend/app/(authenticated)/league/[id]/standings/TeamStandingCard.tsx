'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'
import { formatFantasyPoints } from '@/utils/scoring'
import type { MovieWithScores, RankedTeamFull } from '@/types'
import MovieScoreCard from './MovieScoreCard'
import TeamBudgetSummary, { budgetTone, formatBudget, remainingBudget } from './TeamBudget'
import LeagueMovieModal from '../components/LeagueMovieModal'

interface Props {
  rankedTeam: RankedTeamFull
  /** The league's starting purse, or null when the league doesn't use a fantasy budget. */
  startingBudget: number | null
  isCurrentUser: boolean
  /** Mobile only - above lg the roster lives in the detail rail instead. */
  isExpanded: boolean
  /** Desktop only - which team the detail rail is showing. */
  isSelected: boolean
  onActivate: () => void
  animationDelay?: number
}

/**
 * Ranks 1-3 get the medal gradient. Everything below is a plain elevated chip -
 * a podium that includes eighth place isn't a podium.
 */
const PODIUM_CHIP: Record<number, string> = {
  1: 'bg-[linear-gradient(135deg,#ffd700,#a88c1f)] text-background',
  2: 'bg-[linear-gradient(135deg,#e8e8e8,#a8a8a8)] text-background',
  3: 'bg-[linear-gradient(135deg,#cd9b61,#a56b2d)] text-background',
}

function pointsTone(points: number): string {
  return points >= 0 ? 'text-gold' : 'text-crimson'
}

/** One segment of the points total. Value colour tells you which way it pulled. */
function BreakdownChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="rounded-lg bg-elevated px-2 py-[3px] text-[11px] text-foreground-secondary">
      {label} <span className={`font-semibold ${tone}`}>{formatFantasyPoints(value)}</span>
    </span>
  )
}

export default function TeamStandingCard({
  rankedTeam,
  startingBudget,
  isCurrentUser,
  isExpanded,
  isSelected,
  onActivate,
  animationDelay = 0,
}: Props) {
  const [selected, setSelected] = useState<MovieWithScores | null>(null)
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

  const initials = displayName
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

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
        {/* Line 1 on mobile; the whole row above lg, where the stats move inline */}
        <div className="flex items-center gap-2.5 lg:gap-3.5">
          <div
            className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] font-display text-sm font-bold lg:h-[38px] lg:w-[38px] lg:rounded-[11px] ${
              PODIUM_CHIP[rank] ?? 'border border-border bg-elevated text-foreground-secondary'
            }`}
          >
            {isTied ? 'T' : '#'}
            {rank}
          </div>

          <div className="relative h-[34px] w-[34px] flex-none overflow-hidden rounded-full border-[1.5px] border-gold bg-gold-muted lg:h-[38px] lg:w-[38px]">
            {team?.avatar_url ? (
              <Image src={team.avatar_url} alt={displayName} fill sizes="38px" className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-display text-xs font-bold text-gold lg:text-[13px]">
                {initials}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-display text-[15px] font-semibold text-foreground">{displayName}</span>
              {isCurrentUser && (
                <span className="flex-none rounded-full bg-gold-muted px-1.5 py-px text-[10px] font-semibold text-gold">
                  You
                </span>
              )}
            </div>
            {ownerHandle && <div className="truncate text-xs text-foreground-muted">{ownerHandle}</div>}
          </div>

          {/* Above lg there is room for the stat strip to become columns */}
          <div className="hidden flex-none text-center lg:block lg:w-[72px]">
            <div className="text-[11px] text-foreground-muted">Movies</div>
            <div className="text-[15px] font-semibold text-foreground-secondary">{movieCount}</div>
          </div>

          {/* Spending power is only useful next to everyone else's, so it sits in
              the collapsed row rather than behind an expand. */}
          {budgetLeft !== null && (
            <div className="hidden flex-none text-center lg:block lg:w-[72px]">
              <div className="text-[11px] text-foreground-muted">Budget</div>
              <div className={`text-[15px] font-semibold ${budgetTone(budgetLeft)}`}>{formatBudget(budgetLeft)}</div>
            </div>
          )}

          <div className="flex-none text-right lg:w-[86px]">
            <div
              className={`font-display text-[28px] font-bold leading-none lg:text-[26px] ${pointsTone(totalPoints)}`}
            >
              {formatFantasyPoints(totalPoints)}
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-foreground-muted">Points</div>
          </div>
        </div>

        {/* Line 2 - stat strip, on its own line so nothing collides with the points */}
        <div className="flex items-center gap-2 border-t border-border pt-[9px] lg:hidden">
          <span className="text-xs text-foreground-secondary">{movieCount} movies</span>
          <span className="h-[3px] w-[3px] flex-none rounded-full bg-border-hover" />
          <span className="truncate text-xs text-foreground-muted">
            {moviesScored} scored · {moviesPending} pending
          </span>
          <span className="flex-1" />
          {/* flex-none so the purse survives the truncation the scored/pending
              text takes when a team name pushes the row wide */}
          {budgetLeft !== null && (
            <span className={`flex-none text-xs font-semibold ${budgetTone(budgetLeft)}`}>
              {formatBudget(budgetLeft)}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 flex-none text-foreground-muted transition-transform duration-300 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
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
              movie={pick.movies}
              badge={{ type: 'draft', round: pick.round, pick: pick.pick_number }}
              isCounterpicked={!!pick.counterpicked_by_team_id}
              onSelect={setSelected}
            />
          ))}

          {pickups.map((pickup) => (
            <MovieScoreCard
              key={pickup.id}
              movie={pickup.movies}
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
            <p className="py-3 text-center text-sm text-foreground-muted">No movies drafted yet</p>
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
