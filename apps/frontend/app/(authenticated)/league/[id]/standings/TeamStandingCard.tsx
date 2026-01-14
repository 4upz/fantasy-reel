'use client'

import { useState } from 'react'
import type { RankedTeam } from '@/types'
import MovieScoreCard from './MovieScoreCard'

interface Props {
  rankedTeam: RankedTeam
  isCurrentUser: boolean
  animationDelay?: number
}

const PODIUM_STYLES: Record<number, { gradient: string; shadow: string }> = {
  1: {
    gradient: 'bg-gradient-to-br from-[#ffd700] via-[#c9a227] to-[#a88c1f]',
    shadow: 'shadow-lg shadow-gold/20',
  },
  2: {
    gradient: 'bg-gradient-to-br from-[#e8e8e8] via-[#c0c0c0] to-[#a8a8a8]',
    shadow: 'shadow-lg shadow-white/10',
  },
  3: {
    gradient: 'bg-gradient-to-br from-[#cd9b61] via-[#cd7f32] to-[#a56b2d]',
    shadow: 'shadow-lg shadow-orange-900/20',
  },
}

function RankBadge({ rank, isTied }: { rank: number; isTied: boolean }): React.ReactElement {
  const prefix = isTied ? 'T' : '#'
  const podiumStyle = PODIUM_STYLES[rank]

  if (podiumStyle) {
    return (
      <div className={`w-12 h-12 rounded-xl ${podiumStyle.gradient} flex items-center justify-center ${podiumStyle.shadow}`}>
        <span className="text-lg font-bold font-display text-background">
          {prefix}{rank}
        </span>
      </div>
    )
  }

  return (
    <div className="w-12 h-12 rounded-xl bg-elevated border border-border flex items-center justify-center">
      <span className="text-lg font-bold font-display text-foreground-secondary">
        {prefix}{rank}
      </span>
    </div>
  )
}

export default function TeamStandingCard({
  rankedTeam,
  isCurrentUser,
  animationDelay = 0,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { rank, participant, draftPicks, isTied } = rankedTeam
  const team = participant.teams
  const teamScore = team?.team_scores
  const profile = participant.profiles

  const totalPoints = teamScore?.total_points ?? 0
  const moviesScored = teamScore?.movies_scored ?? 0
  const moviesPending = teamScore?.movies_pending ?? 0
  const averageScore = teamScore?.average_score ?? 0

  const displayName = team?.name || profile?.display_name || 'Unnamed Team'

  // Get initials for avatar fallback
  const initials = displayName
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className={`card overflow-hidden transition-all duration-300 animate-slide-up ${
        isCurrentUser ? 'ring-1 ring-gold/30' : ''
      }`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Main Card Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 sm:p-5 flex items-center gap-4 hover:bg-surface-hover transition-colors text-left"
      >
        {/* Rank Badge */}
        <RankBadge rank={rank} isTied={isTied} />

        {/* Team Avatar */}
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-gold-muted border-2 border-gold flex-shrink-0">
          {team?.avatar_url ? (
            <img
              src={team.avatar_url}
              alt={displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-sm font-display font-bold text-gold">{initials}</span>
            </div>
          )}
        </div>

        {/* Team Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold font-display text-foreground truncate">
              {displayName}
            </h3>
            {isCurrentUser && (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-gold-muted text-gold rounded-full">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-foreground-muted">
            <span>{draftPicks.length} movies</span>
            <span className="text-foreground-muted/50">|</span>
            <span>
              {moviesScored} scored, {moviesPending} pending
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-6 text-center">
          <div>
            <div className="text-sm text-foreground-muted">Avg</div>
            <div className="text-lg font-semibold text-foreground-secondary">
              {moviesScored > 0 ? averageScore.toFixed(1) : '--'}
            </div>
          </div>
        </div>

        {/* Total Points */}
        <div className="text-right">
          <div className="text-3xl sm:text-4xl font-bold font-display text-gold">
            {Math.round(totalPoints)}
          </div>
          <div className="text-[10px] text-foreground-muted uppercase tracking-wide">
            Points
          </div>
        </div>

        {/* Expand Arrow */}
        <div className="ml-2">
          <svg
            className={`w-5 h-5 text-foreground-muted transition-transform duration-300 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Movies List */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-border">
          <div className="pt-4 space-y-3">
            {draftPicks.length > 0 ? (
              draftPicks.map((pick) => (
                <MovieScoreCard
                  key={pick.id}
                  movie={pick.movies}
                  pickNumber={pick.pick_number}
                  round={pick.round}
                />
              ))
            ) : (
              <div className="py-8 text-center text-foreground-muted">
                No movies drafted yet
              </div>
            )}
          </div>

          {/* Score Weights Info */}
          {draftPicks.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-center gap-6 text-[11px] text-foreground-muted">
                <span>Score weights:</span>
                <span className="text-[#f5c518]">IMDb 35%</span>
                <span className="text-[#fa320a]">RT 40%</span>
                <span className="text-[#66cc33]">MC 25%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
