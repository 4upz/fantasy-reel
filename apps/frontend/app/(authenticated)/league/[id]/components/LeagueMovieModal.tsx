'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Film, Lock, Megaphone, TrendingDown, X } from 'lucide-react'
import MovieDetailBody from '@/app/components/MovieDetailBody'
import { useMovieDetails } from '@/hooks/useMovieDetails'
import { formatFantasyPoints } from '@/utils/scoring'
import { getTmdbPosterUrl } from './utils'
import { explainBlocker, type DropBlocker } from '../roster/dropRules'
import type { League, TMDbSearchResult } from '@/types'

/**
 * The least a league surface has to know about a movie to open it. Deliberately
 * loose so the roster, the overview timeline and the standings rail can all
 * pass their own row shape without converting first.
 */
export interface LeagueMovieRef {
  tmdb_id: number
  title: string
  poster_url: string | null
  release_date: string | null
  overview?: string | null
  vote_average?: number | null
  popularity?: number | null
  fantasy_points?: number | null
}

/** Everything the drop step needs. Omit it entirely for a read-only panel. */
export interface DropCapability {
  blocker: DropBlocker | null
  league: League
  dropCount: number
  /** Roster slots filled right now, before this drop. */
  slotsFilled: number
  counterpickerName: string | null
  isDropping: boolean
  error: string | null
  onConfirm: () => void
}

interface LeagueMovieModalProps {
  movie: LeagueMovieRef
  /** Eyebrow above the context line, e.g. "On your roster". */
  contextHeading?: string
  /** How the movie was acquired, e.g. "Round 2, Pick 5" or "$14". */
  contextLabel?: string
  drop?: DropCapability
  onClose: () => void
}

/** Which panel the one dialog is currently showing. */
type View = 'details' | 'confirm'

/**
 * The league's movie dialog: full TMDb details with whatever this surface can
 * do about them, and the drop confirmation as a second view inside the same
 * shell.
 *
 * One overlay, never two stacked. Opening a movie is the neutral, browsable
 * act; committing to a drop is a deliberate step further in, which is why the
 * confirmation replaces the details rather than covering them.
 */
export default function LeagueMovieModal({
  movie,
  contextHeading,
  contextLabel,
  drop,
  onClose,
}: LeagueMovieModalProps) {
  const [view, setView] = useState<View>('details')
  const closeRef = useRef<HTMLButtonElement>(null)

  const isDropping = drop?.isDropping ?? false

  // A failed lookup is not worth an error state: the caller already knows the
  // title, poster and release date, so the panel still reads fine.
  const { details, isLoading: loading } = useMovieDetails(movie.tmdb_id)

  // Escape backs out one step at a time, so a mis-tap on Drop is recoverable
  // without losing the movie you were reading about.
  const handleEscape = useCallback(() => {
    if (isDropping) return
    if (view === 'confirm') setView('details')
    else onClose()
  }, [isDropping, view, onClose])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleEscape])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const hasContext = Boolean(contextHeading || contextLabel || drop)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`${movie.title} details`}
      data-testid="league-movie-modal"
      data-view={view}
    >
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-sm animate-fade-in"
        onClick={isDropping ? undefined : onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-4 my-8 w-full max-w-4xl animate-slide-up sm:my-12">
        <div className="card relative overflow-hidden bg-surface">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={isDropping}
            aria-label="Close"
            data-testid="league-modal-close"
            className="absolute right-4 top-4 z-10 rounded-full border border-border bg-background/50 p-2 text-foreground-muted backdrop-blur-sm transition-all hover:border-border-hover hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Keyed so the swap replays the entry animation and reads as a step
              forward rather than a repaint. */}
          <div key={view} className="animate-fade-in">
            {view === 'details' ? (
              <MovieDetailBody
                movie={toSearchResult(movie)}
                details={details}
                loading={loading}
                collapsibleCast
                actions={
                  hasContext ? (
                    <LeagueActionPanel
                      movie={movie}
                      contextHeading={contextHeading}
                      contextLabel={contextLabel}
                      drop={drop}
                      onDropClick={() => setView('confirm')}
                    />
                  ) : undefined
                }
              />
            ) : (
              drop && (
                <DropConfirmView
                  movie={movie}
                  drop={drop}
                  onBack={() => setView('details')}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The league's own facts about this movie, plus what this surface can do with
 * it. Sits high in the panel, above the synopsis, so the controls are not a
 * scroll away on a phone.
 */
function LeagueActionPanel({
  movie,
  contextHeading,
  contextLabel,
  drop,
  onDropClick,
}: {
  movie: LeagueMovieRef
  contextHeading?: string
  contextLabel?: string
  drop?: DropCapability
  onDropClick: () => void
}) {
  const points = movie.fantasy_points

  return (
    <div className="rounded-lg border border-border bg-elevated/40 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {contextHeading && (
            <p className="text-xs uppercase tracking-wide text-foreground-muted">
              {contextHeading}
            </p>
          )}
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {contextLabel}
            {contextLabel && ' · '}
            {points != null ? (
              <span className={points >= 0 ? 'text-success' : 'text-crimson'}>
                {formatFantasyPoints(points)} pts
              </span>
            ) : (
              'Not scored yet'
            )}
          </p>
        </div>

        {drop && !drop.blocker && (
          <button
            type="button"
            onClick={onDropClick}
            data-testid="drop-movie-button"
            aria-label={`Drop ${movie.title}`}
            className="btn btn-danger h-11 w-full flex-none sm:h-10 sm:w-auto"
          >
            Drop movie
          </button>
        )}
      </div>

      {drop?.blocker && (
        <BlockerNotice
          blocker={drop.blocker}
          movieTitle={movie.title}
          league={drop.league}
          counterpickerName={drop.counterpickerName}
        />
      )}
    </div>
  )
}

/**
 * Why the drop action is absent. Shown inline rather than behind another click:
 * there is room here, and making a player ask twice to learn they cannot act is
 * the gap this whole flow exists to close.
 */
function BlockerNotice({
  blocker,
  movieTitle,
  league,
  counterpickerName,
}: {
  blocker: DropBlocker
  movieTitle: string
  league: League
  counterpickerName: string | null
}) {
  const { headline, detail } = explainBlocker(blocker, {
    movieTitle,
    dropLimit: league.drop_limit,
    leagueStatus: league.status,
    counterpickerName,
  })

  return (
    <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
      <Lock className="mt-0.5 h-4 w-4 flex-none text-foreground-muted" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground" data-testid="drop-blocker-headline">
          {headline}
        </p>
        <p className="mt-1 text-sm text-foreground-secondary">{detail}</p>
      </div>
    </div>
  )
}

function DropConfirmView({
  movie,
  drop,
  onBack,
}: {
  movie: LeagueMovieRef
  drop: DropCapability
  onBack: () => void
}) {
  const { league, dropCount, slotsFilled, isDropping, error, onConfirm } = drop
  const dropsRemainingAfter = league.drop_limit - dropCount - 1

  return (
    <div className="mx-auto max-w-lg p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-crimson/15 text-crimson"
          aria-hidden="true"
        >
          <TrendingDown className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Drop {movie.title}?</h2>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            Dropping is permanent. Read what it costs before you confirm.
          </p>
        </div>
      </div>

      {/* Drop allowance: the scarce thing being spent, shown as countable pips. */}
      <div className="mt-5 rounded-lg border border-border bg-elevated/60 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Your drops</p>
          <p className="text-xs text-foreground-muted">
            {dropCount} of {league.drop_limit} used
          </p>
        </div>
        <DropAllowanceMeter used={dropCount} pending={1} limit={league.drop_limit} />
        <p
          className={`mt-2 text-xs ${dropsRemainingAfter === 0 ? 'text-crimson' : 'text-foreground-secondary'}`}
          data-testid="drops-after-line"
        >
          {dropsRemainingAfter === 0
            ? 'This is your last drop. You will have none left for the rest of the season.'
            : `After this you will have ${dropsRemainingAfter} left for the rest of the season.`}
        </p>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium text-foreground">What happens</p>
        <ul className="space-y-2">
          <Consequence icon={Film}>
            {movie.title} leaves your roster now, freeing a slot &mdash; you will be at{' '}
            {slotsFilled - 1}/{league.total_slots} filled.
          </Consequence>
          <Consequence icon={TrendingDown}>
            {movie.fantasy_points != null
              ? `You give up its ${formatFantasyPoints(movie.fantasy_points)} pts.`
              : 'You give up whatever it scores when it opens, good or bad.'}
          </Consequence>
          <Consequence icon={Megaphone}>
            Everyone in the league is told it is available, and any team can bid on it.
          </Consequence>
        </ul>
      </div>

      <p className="alert alert-warning mt-5 flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <span>This takes effect immediately and cannot be undone.</span>
      </p>

      {error && (
        <p className="alert alert-error mt-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          disabled={isDropping}
          className="btn btn-ghost h-11 sm:h-10"
          data-testid="drop-modal-dismiss"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Keep movie
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDropping}
          aria-busy={isDropping}
          className="btn btn-danger h-11 sm:h-10"
          data-testid="drop-modal-confirm"
        >
          {isDropping ? 'Dropping…' : 'Drop movie'}
        </button>
      </div>
    </div>
  )
}

function Consequence({
  icon: Icon,
  children,
}: {
  icon: typeof Film
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2 text-sm text-foreground-secondary">
      <Icon className="mt-0.5 h-4 w-4 flex-none text-foreground-muted" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

/** Above this many drops the pip row stops reading as a count and becomes noise. */
const MAX_PIPS = 10

/**
 * The drop allowance as discrete pips: spent, about to be spent, and left.
 *
 * A drop limit is a small integer, so showing it as countable marks makes
 * "this is your last one" something the player sees rather than reads.
 */
function DropAllowanceMeter({
  used,
  pending,
  limit,
}: {
  used: number
  pending: number
  limit: number
}) {
  if (limit > MAX_PIPS) return null

  return (
    <div className="mt-2 flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: limit }, (_, i) => {
        const state = i < used ? 'used' : i < used + pending ? 'pending' : 'left'
        return (
          <span
            key={i}
            className={`h-2.5 w-6 rounded-full border ${
              state === 'used'
                ? 'border-foreground-muted bg-foreground-muted'
                : state === 'pending'
                  ? 'border-crimson bg-crimson'
                  : 'border-border-hover bg-transparent'
            }`}
          />
        )
      })}
    </div>
  )
}

/**
 * Adapts a league row to the shape the shared detail panel expects, so the
 * dialog has a title, poster and date to show while TMDb is still loading.
 */
function toSearchResult(movie: LeagueMovieRef): TMDbSearchResult {
  return {
    tmdb_id: movie.tmdb_id,
    title: movie.title,
    overview: movie.overview ?? null,
    release_date: movie.release_date,
    poster_url: getTmdbPosterUrl(movie.poster_url, 'w500'),
    vote_average: movie.vote_average ?? 0,
    popularity: movie.popularity ?? 0,
    genre_ids: [],
  }
}
