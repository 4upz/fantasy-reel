'use client'

import MoviePoster from '@/app/components/MoviePoster'
import { Target } from 'lucide-react'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import type { HoldingMovie } from '@/types'
import TomatometerScore from '@/app/components/TomatometerScore'

type MovieBadge =
  | { type: 'draft'; round: number; pick: number }
  | { type: 'pickup'; amount: number }
  | { type: 'counterpick'; targetTeam: string }

interface Props {
  movie: HoldingMovie
  badge: MovieBadge
  isCounterpicked?: boolean
  /** For counterpicks, fantasy_points is stored on the counterpick row, not the movie */
  overridePoints?: number | null
  /** Opens the movie's details. Omit to render a plain, non-interactive row. */
  onSelect?: (movie: HoldingMovie) => void
}

/**
 * A roster row inside an expanded standings team. The badge on the poster is the
 * only thing that says how the movie was acquired, so the row itself carries no
 * section heading - the three of them read as one list.
 */
/** @design-system League */
export default function MovieScoreCard({
  movie,
  badge,
  isCounterpicked = false,
  overridePoints,
  onSelect,
}: Props) {
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
          ? 'group w-full cursor-pointer transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold'
          : ''
      }`}
      data-testid={`movie-score-card-${badge.type}`}
    >
      {/* Poster */}
      <div className="relative h-[66px] w-11 flex-none">
        <div className="relative h-full w-full overflow-hidden rounded-lg bg-elevated">
          <MoviePoster
            src={movie.poster_url}
            alt={movie.title}
            sizes="44px"
            posterSize="w154"
            className="rounded-lg transition-opacity duration-300 motion-reduce:transition-none"
          />
        </div>

        {/* Acquisition badge */}
        {badge.type === 'draft' && (
          <div className="type-numeric type-meta absolute -top-[7px] -left-[7px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-border bg-surface px-[5px] text-foreground-secondary">
            {badge.round}.{badge.pick}
          </div>
        )}
        {badge.type === 'pickup' && (
          <div className="type-numeric type-meta absolute -top-[7px] -left-[7px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-gold/40 bg-gold/20 px-[5px] text-gold">
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
        <div
          className="type-row-title truncate text-foreground transition-colors group-hover:text-gold"
          title={movie.title}
        >
          {movie.title}
        </div>
        <div className="type-meta truncate text-foreground-secondary">
          {releaseDate}
          {badge.type === 'counterpick' && ` · vs. ${badge.targetTeam}`}
        </div>
        {/* The laurels are too wide for this column, so the pill shimmers instead */}
        <TomatometerScore score={movie.combined_score} size="md" showAccolade={false} className="self-start" />
      </div>

      {/* Fantasy points */}
      <div className="flex-none border-l border-border pl-2.5 text-right">
        <div
          className={`type-number ${
            !hasScore ? 'text-foreground-secondary' : isPositive ? 'text-gold' : 'text-crimson'
          }`}
        >
          {formatFantasyPoints(displayPoints)}
        </div>
        <div className="type-meta text-foreground-secondary">{pointsLabel}</div>
      </div>
    </Row>
  )
}
