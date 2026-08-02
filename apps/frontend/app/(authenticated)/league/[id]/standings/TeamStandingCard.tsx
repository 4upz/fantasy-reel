'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Target, Trophy, ShoppingCart } from 'lucide-react'
import type { RankedTeamFull } from '@/types'
import MovieScoreCard from './MovieScoreCard'

interface Props {
  rankedTeam: RankedTeamFull
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

function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
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

  const { rank, participant, draftPicks, pickups, counterpicks, isTied } = rankedTeam
  const team = participant.teams
  const teamScore = team?.team_scores
  const profile = participant.profiles

  const totalPoints = teamScore?.total_points ?? 0
  const draftPoints = teamScore?.draft_points ?? 0
  const pickupPoints = teamScore?.pickup_points ?? 0
  const counterpickPoints = teamScore?.counterpick_points ?? 0
  const counterpicksMade = teamScore?.counterpicks_made ?? 0
  const moviesScored = teamScore?.movies_scored ?? 0
  const moviesPending = teamScore?.movies_pending ?? 0
  const averageScore = teamScore?.average_score ?? 0
  const isPositive = totalPoints >= 0

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
      data-testid={`team-row-${team?.id}`}
    >
      {/* Main Card Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls={`team-movies-${team?.id}`}
        className="w-full p-4 sm:p-5 flex items-center gap-4 hover:bg-surface-hover transition-colors text-left"
      >
        {/* Rank Badge */}
        <RankBadge rank={rank} isTied={isTied} />

        {/* Team Avatar */}
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-gold-muted border-2 border-gold flex-shrink-0 relative">
          {team?.avatar_url ? (
            <Image
              src={team.avatar_url}
              alt={displayName}
              fill
              sizes="48px"
              className="object-cover"
              unoptimized
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
          {profile?.display_name && team?.name && (
            <p className="text-xs text-foreground-muted truncate">{profile.display_name}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-sm text-foreground-muted">
            <span>{draftPicks.length + pickups.length} movies</span>
            {counterpicks.length > 0 && (
              <>
                <span className="text-foreground-muted/50">|</span>
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3 text-crimson" />
                  {counterpicks.length}
                </span>
              </>
            )}
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
            <div className={`text-lg font-semibold ${moviesScored > 0 && averageScore < 0 ? 'text-crimson' : 'text-foreground-secondary'}`}>
              {moviesScored > 0 ? (averageScore >= 0 ? '+' : '') + averageScore.toFixed(1) : '--'}
            </div>
          </div>
        </div>

        {/* Total Points */}
        <div className="text-right">
          <div className={`text-3xl sm:text-4xl font-bold font-display ${isPositive ? 'text-gold' : 'text-crimson'}`}>
            {formatFantasyPoints(totalPoints)}
          </div>
          <div className="text-[10px] text-foreground-muted uppercase tracking-wide">
            Points
          </div>
          {/* Points Breakdown */}
          <div className="text-xs text-foreground-muted mt-1 flex items-center justify-end gap-2">
            <span className={draftPoints >= 0 ? 'text-gold' : 'text-crimson'}>
              Draft: {formatFantasyPoints(draftPoints)}
            </span>
            {pickups.length > 0 && (
              <>
                <span className="text-foreground-muted/50">|</span>
                <span className="flex items-center gap-1">
                  <ShoppingCart className="w-3 h-3 text-gold" />
                  <span className={pickupPoints >= 0 ? 'text-gold' : 'text-crimson'}>
                    {formatFantasyPoints(pickupPoints)}
                  </span>
                </span>
              </>
            )}
            {counterpicksMade > 0 && (
              <>
                <span className="text-foreground-muted/50">|</span>
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3 text-crimson" />
                  <span className={counterpickPoints >= 0 ? 'text-success' : 'text-crimson'}>
                    {formatFantasyPoints(counterpickPoints)}
                  </span>
                </span>
              </>
            )}
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
        id={`team-movies-${team?.id}`}
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-border">
          {/* Draft Picks Section */}
          <div className="pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
              <Trophy className="w-4 h-4 text-gold" />
              Draft Picks ({draftPicks.length})
            </h4>
            <div className="space-y-3">
              {draftPicks.length > 0 ? (
                draftPicks.map((pick) => (
                  <MovieScoreCard
                    key={pick.id}
                    movie={pick.movies}
                    badge={{ type: 'draft', round: pick.round, pick: pick.pick_number }}
                    isCounterpicked={!!pick.counterpicked_by_team_id}
                  />
                ))
              ) : (
                <div className="py-4 text-center text-foreground-muted text-sm">
                  No movies drafted yet
                </div>
              )}
            </div>
          </div>

          {/* Pickups Section */}
          {pickups.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
                <ShoppingCart className="w-4 h-4 text-gold" />
                Pickups ({pickups.length})
              </h4>
              <div className="space-y-3">
                {pickups.map((pickup) => (
                  <MovieScoreCard
                    key={pickup.id}
                    movie={pickup.movies}
                    badge={{ type: 'pickup', amount: pickup.amount_paid }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Counterpicks Section */}
          {counterpicks.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary mb-3">
                <Target className="w-4 h-4 text-crimson" />
                Counterpicks ({counterpicks.length})
              </h4>
              <div className="space-y-3">
                {counterpicks.map((cp) => (
                  <MovieScoreCard
                    key={cp.id}
                    movie={cp.movies}
                    badge={{ type: 'counterpick', targetTeam: cp.target_team.name }}
                    overridePoints={cp.fantasy_points}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Scoring Formula Info */}
          {(draftPicks.length > 0 || pickups.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-center text-[11px] text-foreground-muted space-y-1">
                <div>Fantasy points based on the Rotten Tomatoes Tomatometer</div>
                <div className="flex items-center justify-center gap-4">
                  <span className="text-gold">90%+: +30 base +2/pt</span>
                  <span className="text-foreground-secondary">60-89%: +1/pt above 60</span>
                  <span className="text-crimson">&lt;60%: -1/pt, tapering</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
