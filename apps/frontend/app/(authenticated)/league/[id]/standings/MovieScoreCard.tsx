'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Target } from 'lucide-react'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import type { MovieWithScores } from '@/types'
import TomatometerScore from '@/app/components/TomatometerScore'
import { getTmdbPosterUrl } from '../components/utils'

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
  /** Opens the movie's details. Omit to render a plain, non-interactive row. */
  onSelect?: (movie: MovieWithScores) => void
}

/**
 * A roster row inside an expanded standings team. The badge on the poster is the
 * only thing that says how the movie was acquired, so the row itself carries no
 * section heading - the three of them read as one list.
 */
export default function MovieScoreCard({
  movie,
  badge,
  isCounterpicked = false,
  overridePoints,
  onSelect,
}: Props) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const displayPoints = overridePoints !== undefined ? overridePoints : movie.fantasy_points
  const hasScore = displayPoints != null
  const isReleased = movie.status === 'released'
  const isPositive = hasScore && displayPoints! >= 0

  const releaseDate = movie.release_date ? formatDate(movie.release_date) : 'TBA'
  const pointsLabel = hasScore ? 'Points' : isReleased ? 'Pending' : 'Upcoming'

  const Row = onSelect ? 'button' : 'div'

  return (
    <Row
      {...(onSelect
        ? {
            type: 'button' as const,
            // The mobile accordion row around this is itself clickable, so the
            // event must not bubble up and collapse the team you just opened a
            // movie from.
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation()
              onSelect(movie)
            },
            'aria-label': `View ${movie.title}`,
            'data-clickable': 'true',
          }
        : {})}
      className={`flex flex-none items-center gap-3 rounded-xl border border-border bg-background p-2.5 text-left ${
        onSelect
          ? 'w-full transition-colors hover:border-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold'
          : ''
      }`}
      data-testid={`movie-score-card-${badge.type}`}
    >
      {/* Poster */}
      <div className="relative h-[66px] w-11 flex-none">
        <div className="h-full w-full overflow-hidden rounded-lg bg-elevated">
          {movie.poster_url && !imageError ? (
            <>
              {!imageLoaded && <div className="absolute inset-0 animate-shimmer rounded-lg bg-elevated" />}
              <Image
                // Stored posters are TMDb paths, not URLs. The raw path made
                // next/image 400 on every row and fall back to the placeholder.
                src={getTmdbPosterUrl(movie.poster_url, 'w154')!}
                alt={movie.title}
                fill
                sizes="44px"
                className={`rounded-lg object-cover transition-opacity duration-300 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg
                className="h-[18px] w-[18px] text-foreground-muted"
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

        {/* Acquisition badge */}
        {badge.type === 'draft' && (
          <div className="absolute -top-[7px] -left-[7px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-border bg-surface px-[5px] text-[10px] font-bold text-foreground-muted">
            {badge.round}.{badge.pick}
          </div>
        )}
        {badge.type === 'pickup' && (
          <div className="absolute -top-[7px] -left-[7px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-gold/40 bg-gold/20 px-[5px] text-[10px] font-bold text-gold">
            ${badge.amount}
          </div>
        )}
        {badge.type === 'counterpick' && (
          <div className="absolute -top-[7px] -left-[7px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-crimson/40 bg-crimson/20 px-[5px] text-crimson">
            <Target className="h-3 w-3" />
          </div>
        )}

        {/* Taken by an opponent's counterpick */}
        {isCounterpicked && (
          <div
            className="absolute -top-[7px] -right-[7px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-crimson bg-crimson/90 text-foreground"
            title="Counterpicked by opponent"
          >
            <Target className="h-3 w-3" />
          </div>
        )}
      </div>

      {/* Title, date, Tomatometer */}
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <div className="truncate text-sm font-semibold text-foreground" title={movie.title}>
          {movie.title}
        </div>
        <div className="truncate text-xs text-foreground-muted">
          {releaseDate}
          {badge.type === 'counterpick' && ` · vs. ${badge.targetTeam}`}
        </div>
        {/* The laurels are too wide for this column, so the pill shimmers instead */}
        <TomatometerScore score={movie.combined_score} size="md" showAccolade={false} className="self-start" />
      </div>

      {/* Fantasy points */}
      <div className="flex-none border-l border-border pl-2.5 text-right">
        <div
          className={`font-display text-xl font-bold ${
            !hasScore ? 'text-foreground-muted' : isPositive ? 'text-gold' : 'text-crimson'
          }`}
        >
          {formatFantasyPoints(displayPoints)}
        </div>
        <div className="text-[9px] uppercase tracking-[0.08em] text-foreground-muted">{pointsLabel}</div>
      </div>
    </Row>
  )
}
