'use client'

import { useMemo } from 'react'
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  RankedTeam,
} from '@/types'
import TeamStandingCard from './TeamStandingCard'

interface Props {
  participants: ParticipantWithTeamScore[]
  draftPicks: DraftPickWithScores[]
  currentUserId: string
}

function calculateRankings(
  participants: ParticipantWithTeamScore[],
  draftPicks: DraftPickWithScores[]
): RankedTeam[] {
  // Group draft picks by team_id
  const picksByTeam = new Map<string, DraftPickWithScores[]>()
  for (const pick of draftPicks) {
    const teamId = pick.team_id
    if (!picksByTeam.has(teamId)) {
      picksByTeam.set(teamId, [])
    }
    picksByTeam.get(teamId)!.push(pick)
  }

  // Sort participants by total_points descending
  const sorted = [...participants].sort((a, b) => {
    const aPoints = a.teams?.team_scores?.total_points ?? 0
    const bPoints = b.teams?.team_scores?.total_points ?? 0
    return bPoints - aPoints
  })

  // Calculate ranks with tie handling
  const ranked: RankedTeam[] = []
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
      isTied: hasTie,
    })

    previousPoints = points
  }

  return ranked
}

export default function StandingsClient({
  participants,
  draftPicks,
  currentUserId,
}: Props) {
  const rankedTeams = useMemo(
    () => calculateRankings(participants, draftPicks),
    [participants, draftPicks]
  )

  const summaryStats = useMemo(() => {
    const moviesScored = draftPicks.filter((pick) => pick.movies?.combined_score != null).length
    const moviesPending = draftPicks.length - moviesScored
    return { moviesScored, moviesPending, totalMovies: draftPicks.length }
  }, [draftPicks])

  return (
    <div className="space-y-6 animate-fade-in" data-testid="standings-container">
      {/* Summary Stats Bar */}
      <div className="flex items-center justify-end">
        <div className="flex gap-6 text-sm">
          <div className="text-center">
            <div className="text-xl font-bold font-display text-gold">{summaryStats.totalMovies}</div>
            <div className="text-foreground-muted text-xs">Total</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-display text-success">{summaryStats.moviesScored}</div>
            <div className="text-foreground-muted text-xs">Scored</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-display text-foreground-secondary">{summaryStats.moviesPending}</div>
            <div className="text-foreground-muted text-xs">Pending</div>
          </div>
        </div>
      </div>

      {/* No Scores Yet Alert */}
      {summaryStats.moviesScored === 0 && (
        <div className="alert alert-info">
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
      <div className="space-y-4">
        {rankedTeams.map((rankedTeam, index) => (
          <TeamStandingCard
            key={rankedTeam.participant.id}
            rankedTeam={rankedTeam}
            isCurrentUser={rankedTeam.participant.user_id === currentUserId}
            animationDelay={index * 100}
          />
        ))}
      </div>

      {/* Empty State */}
      {rankedTeams.length === 0 && (
        <div className="card p-12 text-center">
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
