'use client'

import { useId } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import FantasyPoints from '@/app/components/FantasyPoints'
import ScoreLockLabel from '@/app/components/ScoreLockLabel'
import { getReleaseYear } from '@/utils/date'
import { formatCriticScore, isScoreLocked } from '@/utils/scoring'
import type { TradeableMovie } from '@/types'
import CounterpickMark from './CounterpickMark'

/** Stable empty set so a list with no rejected rows doesn't allocate one per render. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

interface TradeMovieChecklistProps {
  movies: TradeableMovie[]
  selectedIds: ReadonlySet<string>
  onToggle: (sourceId: string) => void
  /** Id of the visible heading that names this side of the deal. */
  labelledBy: string
  /** Rendered instead of the list when there are no movies. */
  emptyState: React.ReactNode
  /** Items the server rejected on the last submit. */
  invalidIds?: ReadonlySet<string>
  /**
   * Points and critic score. Off for a counter's other side, which only has the
   * offer's snapshot and so no score to show.
   */
  showScores?: boolean
}

/**
 * One side of a trade as a list of checkboxes.
 *
 * Native checkboxes rather than a custom listbox: every row is its own named
 * control with a checked state, Space toggles it, and there is no arrow-key
 * model to learn - so the proposal and counter dialogs read the same way.
 *
 * @design-system League
 */
export function TradeMovieChecklist({
  movies,
  selectedIds,
  onToggle,
  labelledBy,
  emptyState,
  invalidIds = EMPTY_IDS,
  showScores = true,
}: TradeMovieChecklistProps) {
  const baseId = useId()

  if (movies.length === 0) return <>{emptyState}</>

  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2 max-h-48 overflow-y-auto p-1 -m-1">
      {movies.map((movie) => {
        const isSelected = selectedIds.has(movie.source_id)
        const isInvalid = invalidIds.has(movie.source_id)
        const isLocked = isScoreLocked(movie.fantasy_points)
        // A scored movie is locked against trades: it can be taken back out,
        // never added. Still focusable, so the row and its reason are found.
        const isDisabled = isLocked && !isSelected
        const titleId = `${baseId}-${movie.source_id}-title`
        const detailsId = `${baseId}-${movie.source_id}-details`

        return (
          <label
            key={movie.source_id}
            className={`w-full p-2 rounded-lg flex items-center gap-3 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface ${
              isInvalid
                ? 'bg-crimson/15 border border-crimson'
                : isSelected
                  ? 'bg-gold/20 border border-gold'
                  : isDisabled
                    ? 'bg-surface-hover border border-transparent opacity-60'
                    : 'bg-surface-hover hover:bg-elevated border border-transparent'
            } ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="relative w-8 h-12 shrink-0 rounded bg-surface-hover">
              <MoviePoster
                src={movie.poster_url}
                alt=""
                sizes="32px"
                posterSize="w92"
                className="rounded"
              />
              {movie.source === 'counterpick' && <CounterpickMark />}
            </div>
            <div className="min-w-0 flex-1">
              <p id={titleId} className="type-row-title text-foreground break-words">{movie.title}</p>
              <div
                id={detailsId}
                className="type-meta flex flex-wrap items-center gap-x-2 text-foreground-secondary"
              >
                {/* The alert above carries the reason; this only says which row
                    it meant, and carries it in text rather than colour alone. */}
                {isInvalid && <span className="font-medium text-crimson-text">Can&apos;t be traded</span>}
                {isLocked && !isInvalid && <ScoreLockLabel>can&apos;t be traded</ScoreLockLabel>}
                {movie.source === 'counterpick' && (
                  <span className="text-crimson-text">
                    {movie.counterpick_target_team_name ? (
                      <>
                        <span className="sr-only">Counterpick </span>vs. {movie.counterpick_target_team_name}
                      </>
                    ) : (
                      'Counterpick'
                    )}
                  </span>
                )}
                {movie.release_date && <span>{getReleaseYear(movie.release_date)}</span>}
                {showScores && (movie.fantasy_points !== null ? (
                  <>
                    {/* For a counterpick, the inverted score waits on its target's release. */}
                    <FantasyPoints points={movie.fantasy_points} releaseDate={movie.release_date} />
                    {movie.combined_score !== null && (
                      <span>{formatCriticScore(movie.combined_score)}</span>
                    )}
                  </>
                ) : (
                  <span>Pending</span>
                ))}
              </div>
            </div>
            <span className="relative w-5 h-5 shrink-0">
              <input
                type="checkbox"
                checked={isSelected}
                aria-disabled={isDisabled || undefined}
                aria-labelledby={titleId}
                aria-describedby={detailsId}
                onChange={() => {
                  if (!isDisabled) onToggle(movie.source_id)
                }}
                className={`block w-5 h-5 appearance-none rounded border-2 focus-visible:outline-none ${
                  isSelected ? 'border-gold bg-gold' : 'border-border'
                } ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              />
              {isSelected && (
                <svg
                  className="pointer-events-none absolute inset-0 m-auto w-3 h-3 text-foreground-inverse"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </span>
          </label>
        )
      })}
    </div>
  )
}

interface TradeBudgetFieldProps {
  /** Whose budget moves, read after "Budget": "you give", "you request from Owner Team". */
  side: string
  /**
   * The paying team's remaining budget. `null` when it could not be loaded (the
   * field is disabled), `undefined` when it isn't known here at all.
   */
  available: number | null | undefined
  value: number
  onChange: (value: number) => void
  /** The input's max when `available` is unknown. */
  fallbackMax?: number
}

/**
 * The budget half of one side of a trade. The visible label stays short; the
 * side is spoken, because both sides' fields otherwise share one name.
 *
 * @design-system League
 */
export function TradeBudgetField({
  side,
  available,
  value,
  onChange,
  fallbackMax,
}: TradeBudgetFieldProps) {
  const id = useId()
  const isUnavailable = available === null

  return (
    <div className="mt-3">
      <label htmlFor={id} className="type-label text-foreground-secondary">
        Budget
        <span className="sr-only"> {side}{isUnavailable ? ',' : ''}</span>
        {isUnavailable ? ' unavailable' : available !== undefined ? ` (max $${available})` : ''}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={available ?? fallbackMax}
        value={value}
        disabled={isUnavailable}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="type-input type-numeric input mt-1 w-24"
      />
    </div>
  )
}

/** The ✕ in a trade dialog's header: a 24px+ target with a spoken name. */
export function DialogCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-m-2 p-2 text-foreground-secondary hover:text-foreground transition-colors cursor-pointer"
      aria-label={label}
    >
      <span aria-hidden="true">✕</span>
    </button>
  )
}
