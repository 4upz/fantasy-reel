'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Target } from 'lucide-react'
import { formatDate } from '@/utils/date'
import type { MovieWithScores } from '@/types'
import ScoreSourceBadge from './ScoreSourceBadge'

type MovieBadge =
  | { type: 'draft'; round: number; pick: number }
  | { type: 'pickup'; amount: number }
  | { type: 'counterpick'; targetTeam: string }

interface Props {
  movie: MovieWithScores
  badge: MovieBadge
  isCounterpicked?: boolean
  /** For counterpicks, fantasy_points is stored on the counterpick row, not the movie */
  overridePoints?: number | null
}

function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

function BonusBadge({ type, active }: { type: 'fresh' | 'darling' | 'disaster'; active: boolean }) {
  if (!active) return null

  const config = {
    fresh: { label: 'CF', title: 'Certified Fresh (+3)', className: 'bg-[#fa320a]/20 text-[#fa320a] border-[#fa320a]/30' },
    darling: { label: '★', title: 'Critical Darling (+5)', className: 'bg-gold/20 text-gold border-gold/30' },
    disaster: { label: '💀', title: 'Critical Disaster (-5)', className: 'bg-crimson/20 text-crimson border-crimson/30' },
  }

  const { label, title, className } = config[type]

  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-bold border rounded ${className}`}
      title={title}
    >
      {label}
    </span>
  )
}

export default function MovieScoreCard({ movie, badge, isCounterpicked = false, overridePoints }: Props) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const displayPoints = overridePoints !== undefined ? overridePoints : movie.fantasy_points
  const hasScore = displayPoints != null
  const isReleased = movie.status === 'released'
  const isPositive = hasScore && displayPoints! >= 0

  // Get individual review scores
  const imdbReview = movie.reviews?.find((r) => r.source === 'imdb')
  const rtReview = movie.reviews?.find((r) => r.source === 'rotten_tomatoes')
  const mcReview = movie.reviews?.find((r) => r.source === 'metacritic')

  const releaseDate = movie.release_date ? formatDate(movie.release_date) : 'TBA'

  // Get scoring bonuses
  const bonuses = movie.scoring_bonuses

  return (
    <div className="flex gap-4 p-4 bg-elevated/50 rounded-xl border border-border hover:border-border-hover transition-colors">
      {/* Movie Poster */}
      <div className="relative w-16 sm:w-20 flex-shrink-0">
        <div className="aspect-[2/3] rounded-lg overflow-hidden bg-surface">
          {movie.poster_url && !imageError ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 bg-surface animate-shimmer" />
              )}
              <Image
                src={movie.poster_url}
                alt={movie.title}
                fill
                sizes="80px"
                className={`object-cover transition-opacity duration-300 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-foreground-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
            </div>
          )}
        </div>
        {/* Badge */}
        {badge.type === 'draft' && (
          <div className="absolute -top-2 -left-2 w-6 h-6 bg-surface border border-border rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-foreground-muted">
              {badge.round}.{badge.pick}
            </span>
          </div>
        )}
        {badge.type === 'pickup' && (
          <div className="absolute -top-2 -left-2 h-6 px-1.5 bg-gold/20 border border-gold/40 rounded-full flex items-center justify-center">
            <span className="text-[10px] font-bold text-gold">
              ${badge.amount}
            </span>
          </div>
        )}
        {badge.type === 'counterpick' && (
          <div className="absolute -top-2 -left-2 w-6 h-6 bg-crimson/20 border border-crimson/40 rounded-full flex items-center justify-center">
            <Target className="w-3 h-3 text-crimson" />
          </div>
        )}
        {/* Counterpicked Indicator */}
        {isCounterpicked && (
          <div
            className="absolute -top-2 -right-2 w-6 h-6 bg-crimson/90 border border-crimson rounded-full flex items-center justify-center"
            title="Counterpicked by opponent"
          >
            <Target className="w-3.5 h-3.5 text-white" />
          </div>
        )}
      </div>

      {/* Movie Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-foreground truncate" title={movie.title}>
          {movie.title}
        </h4>
        <div className="flex items-center gap-2 mt-1 text-sm text-foreground-muted">
          <span>{releaseDate}</span>
          {badge.type === 'counterpick' && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-crimson/10 text-crimson border border-crimson/20 rounded flex items-center gap-1">
              <Target className="w-2.5 h-2.5" />
              vs. {badge.targetTeam}
            </span>
          )}
          {!isReleased && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning border border-warning/20 rounded">
              Upcoming
            </span>
          )}
          {/* Bonus Badges */}
          {bonuses && (
            <>
              <BonusBadge type="fresh" active={bonuses.certified_fresh} />
              <BonusBadge type="darling" active={bonuses.critical_darling} />
              <BonusBadge type="disaster" active={bonuses.critical_disaster} />
            </>
          )}
        </div>

        {/* Score Sources */}
        <div className="flex items-center gap-3 mt-3">
          <ScoreSourceBadge source="imdb" score={imdbReview?.score ?? null} />
          <ScoreSourceBadge source="rotten_tomatoes" score={rtReview?.score ?? null} />
          <ScoreSourceBadge source="metacritic" score={mcReview?.score ?? null} />
        </div>
      </div>

      {/* Fantasy Points */}
      <div className="flex flex-col items-center justify-center pl-4 border-l border-border">
        {hasScore ? (
          <>
            <div className={`text-3xl font-bold font-display ${isPositive ? 'text-gold' : 'text-crimson'}`}>
              {formatFantasyPoints(displayPoints!)}
            </div>
            <div className="text-[10px] text-foreground-muted uppercase tracking-wide">
              Points
            </div>
            {/* Show raw critic score for context */}
            {movie.combined_score != null && (
              <div className="text-[10px] text-foreground-muted mt-1">
                {Math.round(movie.combined_score)} avg
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-2xl font-bold font-display text-foreground-muted">--</div>
            <div className="text-[10px] text-foreground-muted uppercase tracking-wide">
              {isReleased ? 'Pending' : 'Upcoming'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
