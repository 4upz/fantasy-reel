'use client'

import { useMemo, useState } from 'react'
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  PickupWithScores,
  CounterpickWithScores,
  RankedTeamFull,
} from '@/types'
import TeamStandingCard from './TeamStandingCard'

interface Props {
  participants: ParticipantWithTeamScore[]
  draftPicks: DraftPickWithScores[]
  pickups: PickupWithScores[]
  counterpicks: CounterpickWithScores[]
  currentUserId: string
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

function calculateRankings(
  participants: ParticipantWithTeamScore[],
  draftPicks: DraftPickWithScores[],
  pickups: PickupWithScores[],
  counterpicks: CounterpickWithScores[],
): RankedTeamFull[] {
  const picksByTeam = groupBy(draftPicks, (p) => p.team_id)
  const pickupsByTeam = groupBy(pickups, (p) => p.team_id)
  const counterpicksByTeam = groupBy(counterpicks, (cp) => cp.counterpicker_team_id)

  // Sort participants by total_points descending
  const sorted = [...participants].sort((a, b) => {
    const aPoints = a.teams?.team_scores?.total_points ?? 0
    const bPoints = b.teams?.team_scores?.total_points ?? 0
    return bPoints - aPoints
  })

  // Calculate ranks with tie handling
  const ranked: RankedTeamFull[] = []
  let currentRank = 1
  let previousPoints: number | null = null

  for (let i = 0; i < sorted.length; i++) {
    const participant = sorted[i]
    const points = participant.teams?.team_scores?.total_points ?? 0
    const teamId = participant.teams?.id

    // Check for ties
    const isTied = previousPoints !== null && points === previousPoints
    if (!isTied && i > 0) {
      currentRank = i + 1
    }

    // Check if next participant has same points (also tied)
    const nextPoints = sorted[i + 1]?.teams?.team_scores?.total_points ?? null
    const hasTie = isTied || (nextPoints !== null && points === nextPoints)

    ranked.push({
      rank: currentRank,
      participant,
      draftPicks: teamId ? picksByTeam.get(teamId) || [] : [],
      pickups: teamId ? pickupsByTeam.get(teamId) || [] : [],
      counterpicks: teamId ? counterpicksByTeam.get(teamId) || [] : [],
      isTied: hasTie,
    })

    previousPoints = points
  }

  return ranked
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
  draftPicks,
  pickups,
  counterpicks,
  currentUserId,
}: Props) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)

  const rankedTeams = useMemo(
    () => calculateRankings(participants, draftPicks, pickups, counterpicks),
    [participants, draftPicks, pickups, counterpicks]
  )

  const summaryStats = useMemo(() => {
    const allMovies = [
      ...draftPicks.map((p) => p.movies),
      ...pickups.map((p) => p.movies),
      ...counterpicks.map((cp) => cp.movies),
    ]
    const moviesScored = allMovies.filter((m) => m?.combined_score != null).length
    const moviesPending = allMovies.length - moviesScored
    return { moviesScored, moviesPending, totalMovies: allMovies.length }
  }, [draftPicks, pickups, counterpicks])

  // The page is a flex column, so every direct child needs flex-none or it gets
  // squashed instead of adding to the scroll length.
  return (
    <div className="flex animate-fade-in flex-col gap-3" data-testid="standings-container">
      {/* Summary strip */}
      <div className="grid flex-none grid-cols-3 gap-2">
        <SummaryCard value={summaryStats.totalMovies} label="Movies" tone="text-gold" />
        <SummaryCard value={summaryStats.moviesScored} label="Scored" tone="text-success" />
        <SummaryCard value={summaryStats.moviesPending} label="Pending" tone="text-foreground-secondary" />
      </div>

      {/* No Scores Yet Alert */}
      {summaryStats.moviesScored === 0 && (
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
        const teamId = rankedTeam.participant.teams?.id ?? rankedTeam.participant.id
        return (
          <TeamStandingCard
            key={rankedTeam.participant.id}
            rankedTeam={rankedTeam}
            isCurrentUser={rankedTeam.participant.user_id === currentUserId}
            isExpanded={expandedTeamId === teamId}
            onToggle={() => setExpandedTeamId((current) => (current === teamId ? null : teamId))}
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
  )
}
