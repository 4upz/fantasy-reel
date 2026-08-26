'use client'

import { TrendingUp } from 'lucide-react'
import type { FranchiseHistory } from '@/types'
import { ordinal } from '@/utils/franchise'
import { getReleaseYear } from '@/utils/date'
import { fantasyPointsForTomatometer, formatSignedPoints } from '@/utils/scoring'
import TomatometerScore from './TomatometerScore'

interface Props {
  history: FranchiseHistory
  /** The movie whose history this is -- the last, still-unscored point on the line. */
  movieTitle: string
  movieReleaseDate: string | null
  className?: string
}

/** Points are RT - 60, so 60 is where a movie starts earning instead of losing. */
const BREAK_EVEN = 60

const CHART_HEIGHT = 72
const CHART_PAD = 8

/** Maps a Tomatometer onto the chart's y axis: 100 at the top, 0 at the bottom. */
function yFor(score: number): number {
  return CHART_PAD + ((100 - score) / 100) * (CHART_HEIGHT - CHART_PAD * 2)
}

/** Column centres as SVG percentages, so the chart lines up with the row of labels under it. */
function xFor(index: number, count: number): string {
  return `${((index + 0.5) / count) * 100}%`
}

/** One prior film's Tomatometer, placed on the chart. Unscored films get no point. */
interface ChartPoint {
  /** Which label column the point sits over. */
  index: number
  y: number
  /** At or above break-even, so the point is gold rather than crimson. */
  fresh: boolean
}

/**
 * The full read on a movie's franchise, for the movie preview dialog where
 * there is room for a shape: every prior film's Tomatometer as a line against
 * the 60% break-even, then the film itself as a hollow point still to be
 * drawn. The line is the signature -- it shows a series drifting below
 * break-even in a way a lone average never can.
 */
export default function FranchiseHistoryPanel({
  history,
  movieTitle,
  movieReleaseDate,
  className = '',
}: Props) {
  const { films } = history
  const columns = films.length + 1
  const scored: ChartPoint[] = films.flatMap((film, index) =>
    film.rt_score == null
      ? []
      : [{ index, y: yFor(film.rt_score), fresh: film.rt_score >= BREAK_EVEN }]
  )
  const lastScored = scored.length > 0 ? scored[scored.length - 1] : null
  // With nothing scored, the still-unscored movie sits on the break-even line.
  const lastY = lastScored ? lastScored.y : yFor(BREAK_EVEN)
  const aboveBreakEven = scored.filter((point) => point.fresh).length

  return (
    <section
      className={`p-4 rounded-xl bg-surface-hover border border-border ${className}`}
      aria-label="Franchise history"
      data-testid="franchise-history-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
            Franchise history
          </p>
          <h3 className="font-display text-[15px] font-semibold text-foreground">
            {history.collection_name}
            <span className="font-normal text-foreground-muted"> · {ordinal(history.entry_number)} film</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted">Series avg</span>
          <TomatometerScore score={history.average_rt} size="md" showAccolade={false} />
        </div>
      </div>

      <div className="mt-3.5">
        {/* No viewBox on purpose: x is in percentages and y in px, so the
            chart stretches to the row of labels under it without distorting
            the marks. */}
        <svg width="100%" height={CHART_HEIGHT} className="block" aria-hidden="true">
          <line x1="0" x2="100%" y1={yFor(BREAK_EVEN)} y2={yFor(BREAK_EVEN)} stroke="var(--color-border-hover)" strokeWidth="1" strokeDasharray="3 4" />
          {scored.slice(1).map((point, i) => (
            <line
              key={point.index}
              x1={xFor(scored[i].index, columns)}
              y1={scored[i].y}
              x2={xFor(point.index, columns)}
              y2={point.y}
              stroke="var(--color-foreground-muted)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
          {lastScored && (
            <line
              x1={xFor(lastScored.index, columns)}
              y1={lastY}
              x2={xFor(columns - 1, columns)}
              y2={lastY}
              stroke="var(--color-border-hover)"
              strokeWidth="2"
              strokeDasharray="2 5"
              strokeLinecap="round"
            />
          )}
          {scored.map((point) => (
            <circle
              key={point.index}
              cx={xFor(point.index, columns)}
              cy={point.y}
              r="5"
              fill={point.fresh ? 'var(--color-gold)' : 'var(--color-crimson)'}
            />
          ))}
          <circle
            cx={xFor(columns - 1, columns)}
            cy={lastY}
            r="5"
            fill="var(--color-surface-hover)"
            stroke="var(--color-gold)"
            strokeWidth="2"
            strokeDasharray="2 2"
          />
        </svg>

        <div className="mt-1.5 flex items-start gap-3">
          {films.map((film) => (
            <div key={film.tmdb_id} className="flex-1 min-w-0 flex flex-col items-center gap-1 text-center">
              <TomatometerScore score={film.rt_score} size="sm" showAccolade={false} />
              <span className="max-w-full truncate text-xs font-medium text-foreground" title={film.title}>
                {film.title}
              </span>
              {film.release_date && (
                <span className="text-[11px] text-foreground-muted">{getReleaseYear(film.release_date)}</span>
              )}
            </div>
          ))}
          <div className="flex-1 min-w-0 flex flex-col items-center gap-1 text-center">
            <TomatometerScore score={null} size="sm" showAccolade={false} />
            <span className="max-w-full truncate text-xs font-semibold text-gold" title={movieTitle}>
              {movieTitle}
            </span>
            <span className="text-[11px] text-foreground-muted">
              {movieReleaseDate ? `${getReleaseYear(movieReleaseDate)} · this pick` : 'this pick'}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs text-foreground-secondary">
        <TrendingUp className="w-3.5 h-3.5 shrink-0 text-foreground-muted" />
        <span>
          Dashed line is the {BREAK_EVEN}% break-even.{' '}
          {scored.length > 0 ? (
            <>
              {aboveBreakEven} of {scored.length} prior {scored.length === 1 ? 'film' : 'films'} landed
              above it
              {history.average_rt != null && (
                <>
                  ; at the series average this pick would score{' '}
                  <strong className="text-gold">
                    {formatSignedPoints(fantasyPointsForTomatometer(history.average_rt))} pts
                  </strong>
                </>
              )}
              .
            </>
          ) : (
            'None of the prior films have a Tomatometer yet.'
          )}
        </span>
      </p>
    </section>
  )
}
