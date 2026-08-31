'use client'

import { useMemo, useState } from 'react'
import type {
  ParticipantWithTeamScore,
  DraftHolding,
  PickupHolding,
  CounterpickWithScores,
  RankedTeamFull,
  StandingRow,
} from '@/types'
import type { ReigningChampions } from '@/utils/seasonQueries'
import { championPoints, type Champion } from '@/utils/seasons'
import TeamStandingCard from './TeamStandingCard'
import TeamDetailRail from './TeamDetailRail'
import ChampionBanner from '../components/ChampionBanner'

interface Props {
  participants: ParticipantWithTeamScore[]
  /**
   * The `league_standings` RPC's rows, in rank order. The only source of rank -
   * the page and the champion banner cannot disagree about who is first.
   */
  standings: StandingRow[]
  draftPicks: DraftHolding[]
  pickups: PickupHolding[]
  counterpicks: CounterpickWithScores[]
  currentUserId: string
  /** The league's configured starting purse; 0 means this league doesn't use a fantasy budget. */
  startingBudget: number
  seasonYear: number
  isCompleted: boolean
  /** Every team at rank 1 on a completed season; empty while it is still running. */
  champions: Champion[]
  /** Last season's winners, crowned beside their names this season. */
  reigningChampions: ReigningChampions | null
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(item)
  }
  return map
}

/**
 * Hangs each team's rosters off the ranking the database already computed.
 *
 * Rank and ties are no longer worked out here: `league_standings` is the one
 * ranking every consumer reads - this table, the champion banner, the Discord
 * embed, the final-standings email - so a tie can never be a tie in one place
 * and a clean win in another.
 */
function buildRankedTeams(
  standings: StandingRow[],
  participants: ParticipantWithTeamScore[],
  draftPicks: DraftHolding[],
  pickups: PickupHolding[],
  counterpicks: CounterpickWithScores[],
): RankedTeamFull[] {
  const picksByTeam = groupBy(draftPicks, (p) => p.team_id)
  const pickupsByTeam = groupBy(pickups, (p) => p.team_id)
  const counterpicksByTeam = groupBy(counterpicks, (cp) => cp.counterpicker_team_id)
  const participantByTeamId = new Map(
    participants.filter((p) => p.teams).map((p) => [p.teams!.id, p])
  )

  return standings.flatMap((row) => {
    const participant = participantByTeamId.get(row.team_id)
    if (!participant) return []

    return [
      {
        rank: row.rank,
        participant,
        draftPicks: picksByTeam.get(row.team_id) ?? [],
        pickups: pickupsByTeam.get(row.team_id) ?? [],
        counterpicks: counterpicksByTeam.get(row.team_id) ?? [],
        isTied: row.is_tied,
      },
    ]
  })
}

/** Teams normally have a row in `teams`; fall back to the participant if not. */
function teamKey(rankedTeam: RankedTeamFull): string {
  return rankedTeam.participant.teams?.id ?? rankedTeam.participant.id
}

function SummaryCard({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2 py-2.5 text-center">
      <div className={`font-display text-xl font-bold ${tone}`}>{value}</div>
      <div className="mt-px text-[11px] text-foreground-muted">{label}</div>
    </div>
  )
}

export default function StandingsClient({
  participants,
  standings,
  draftPicks,
  pickups,
  counterpicks,
  currentUserId,
  startingBudget,
  seasonYear,
  isCompleted,
  champions,
  reigningChampions,
}: Props) {
  const showBudget = startingBudget > 0
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const rankedTeams = useMemo(
    () => buildRankedTeams(standings, participants, draftPicks, pickups, counterpicks),
    [standings, participants, draftPicks, pickups, counterpicks]
  )

  // The rail opens on your own team - the one you came to the page to check.
  const railTeam = useMemo(() => {
    const own = rankedTeams.find((t) => t.participant.user_id === currentUserId)
    if (!selectedTeamId) return own ?? rankedTeams[0] ?? null
    return rankedTeams.find((t) => teamKey(t) === selectedTeamId) ?? own ?? rankedTeams[0] ?? null
  }, [rankedTeams, selectedTeamId, currentUserId])

  /**
   * The season a row's owner wears a crown for: this one if they just won it,
   * or last one if they are defending it. Never both - a completed season has
   * no reigning champion to show, its own winner is the story.
   */
  function crownedSeason(rankedTeam: RankedTeamFull): number | null {
    const teamId = rankedTeam.participant.teams?.id
    if (isCompleted) {
      return teamId && champions.some((champion) => champion.teamId === teamId) ? seasonYear : null
    }
    return reigningChampions?.userIds.includes(rankedTeam.participant.user_id)
      ? reigningChampions.seasonYear
      : null
  }

  const summaryStats = useMemo(() => {
    const allMovies = [
      ...draftPicks.map((p) => p.movie),
      ...pickups.map((p) => p.movie),
      ...counterpicks.map((cp) => cp.movies),
    ]
    const moviesScored = allMovies.filter((m) => m?.combined_score != null).length
    const moviesPending = allMovies.length - moviesScored
    return { moviesScored, moviesPending, totalMovies: allMovies.length }
  }, [draftPicks, pickups, counterpicks])

  // Above lg the list keeps its own column and the detail rail sits beside it.
  // The list is a flex column, so every direct child needs flex-none or it gets
  // squashed instead of adding to the scroll length.
  return (
    <div className="animate-fade-in lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-5">
      <div className="flex flex-col gap-3" data-testid="standings-container">
      {isCompleted && (
        <div className="flex-none">
          <ChampionBanner
            seasonYear={seasonYear}
            champions={champions}
            points={championPoints(champions, standings)}
          />
        </div>
      )}

      {/* Summary strip. A finished season labels its own numbers - they are a
          record now, not a running count. */}
      {isCompleted && (
        <p className="flex-none font-mono text-[11px] uppercase tracking-[0.1em] text-foreground-muted">
          Final · {seasonYear} season
        </p>
      )}
      <div className="grid flex-none grid-cols-3 gap-2">
        <SummaryCard value={summaryStats.totalMovies} label="Movies" tone="text-gold" />
        <SummaryCard value={summaryStats.moviesScored} label="Scored" tone="text-success" />
        <SummaryCard value={summaryStats.moviesPending} label="Pending" tone="text-foreground-secondary" />
      </div>

      {/* No Scores Yet Alert. Never on a completed season: nothing is coming,
          and the banner has already said the season is over. */}
      {summaryStats.moviesScored === 0 && !isCompleted && (
        <div className="alert alert-info flex-none">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium">No scores available yet</p>
              <p className="text-sm mt-1 opacity-80">
                Scores are calculated nightly for released movies. Check back after movies in your draft have been released!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {rankedTeams.map((rankedTeam, index) => {
        const teamId = teamKey(rankedTeam)
        return (
          <TeamStandingCard
            key={rankedTeam.participant.id}
            rankedTeam={rankedTeam}
            startingBudget={showBudget ? startingBudget : null}
            isCurrentUser={rankedTeam.participant.user_id === currentUserId}
            reigningChampionSeason={crownedSeason(rankedTeam)}
            isExpanded={expandedTeamId === teamId}
            isSelected={railTeam != null && teamKey(railTeam) === teamId}
            onActivate={() => {
              // One tap serves both shapes: the accordion below lg, the rail above it.
              setExpandedTeamId((current) => (current === teamId ? null : teamId))
              setSelectedTeamId(teamId)
            }}
            animationDelay={index * 100}
          />
        )
      })}

      {/* Empty State */}
      {rankedTeams.length === 0 && (
        <div className="card flex-none p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-elevated flex items-center justify-center">
            <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-display font-semibold text-foreground">No teams yet</h3>
          <p className="mt-2 text-foreground-muted">Teams will appear here once the draft begins.</p>
        </div>
      )}
      </div>

      {railTeam && <TeamDetailRail rankedTeam={railTeam} startingBudget={showBudget ? startingBudget : null} />}
    </div>
  )
}
