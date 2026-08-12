'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { AlertTriangle, Film, Lock, Megaphone, TrendingDown } from 'lucide-react'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import { explainBlocker, type DropBlocker } from './dropRules'
import type { League, Movie } from '@/types'

interface DropMovieModalProps {
  movie: Movie
  /** The card's subtitle, e.g. "Round 2, Pick 5" or "$14". */
  label: string
  /** Set when the movie cannot be dropped; the modal then explains instead of confirming. */
  blocker: DropBlocker | null
  counterpickerName: string | null
  league: League
  dropCount: number
  /** Roster slots filled right now, before this drop. */
  slotsFilled: number
  isDropping: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

/**
 * The single place a player is told what a drop costs, or why they cannot make
 * one.
 *
 * A drop is irreversible, spends a scarce allowance, and hands the movie to the
 * rest of the league, so it gets a real dialog rather than a confirmation
 * tucked into the poster art.
 */
export default function DropMovieModal({
  movie,
  label,
  blocker,
  counterpickerName,
  league,
  dropCount,
  slotsFilled,
  isDropping,
  error,
  onClose,
  onConfirm,
}: DropMovieModalProps) {
  const dismissRef = useRef<HTMLButtonElement>(null)

  // Land focus on the safe action, never on the destructive one.
  useEffect(() => {
    dismissRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDropping) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isDropping])

  // Stop the roster scrolling behind the dialog on touch.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const titleId = 'drop-movie-title'
  const dropsRemainingAfter = league.drop_limit - dropCount - 1

  return (
    <div
      className="modal-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="drop-movie-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDropping) onClose()
      }}
    >
      <div className="modal-panel glass w-full max-w-md rounded-lg border border-border shadow-heavy">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border p-4">
          <span
            className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${
              blocker ? 'bg-elevated text-foreground-muted' : 'bg-crimson/15 text-crimson'
            }`}
            aria-hidden="true"
          >
            {blocker ? <Lock className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-bold text-foreground">
              {blocker ? 'You can’t drop this movie' : 'Drop this movie?'}
            </h2>
            <p className="mt-0.5 text-sm text-foreground-secondary">
              {blocker
                ? 'Here is what is standing in the way.'
                : 'Dropping is permanent. Read what it costs before you confirm.'}
            </p>
          </div>
        </div>

        {/* The movie in question */}
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="relative h-[84px] w-14 flex-none overflow-hidden rounded bg-elevated">
            {movie.poster_url ? (
              <Image
                src={`https://image.tmdb.org/t/p/w154${movie.poster_url}`}
                alt=""
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Film className="h-5 w-5 text-foreground-muted" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{movie.title}</p>
            <p className="text-xs text-foreground-muted">{label}</p>
            <p className="mt-1 text-xs text-foreground-muted">{describeRelease(movie)}</p>
          </div>
        </div>

        {blocker ? (
          <BlockedBody
            blocker={blocker}
            movieTitle={movie.title}
            league={league}
            counterpickerName={counterpickerName}
          />
        ) : (
          <ConfirmBody
            movie={movie}
            league={league}
            dropCount={dropCount}
            slotsFilled={slotsFilled}
            dropsRemainingAfter={dropsRemainingAfter}
          />
        )}

        {error && (
          <div className="px-4 pb-1">
            <p className="alert alert-error text-sm" role="alert">
              {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            ref={dismissRef}
            type="button"
            onClick={onClose}
            disabled={isDropping}
            className={blocker ? 'btn btn-primary' : 'btn btn-ghost'}
            data-testid="drop-modal-dismiss"
          >
            {blocker ? 'Got it' : 'Keep movie'}
          </button>
          {!blocker && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDropping}
              aria-busy={isDropping}
              className="btn btn-danger"
              data-testid="drop-modal-confirm"
            >
              {isDropping ? 'Dropping…' : 'Drop movie'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** A release line that reads correctly whether the movie is out or still coming. */
function describeRelease(movie: Movie): string {
  if (!movie.release_date) return 'Release date TBA'

  const today = new Date().toISOString().split('T')[0]
  const verb = movie.release_date < today ? 'Opened' : 'Opens'
  return `${verb} ${formatDate(movie.release_date)}`
}

function BlockedBody({
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
    <div className="p-4">
      <div className="rounded-lg border border-border bg-elevated/60 p-3">
        <p className="text-sm font-medium text-foreground" data-testid="drop-blocker-headline">
          {headline}
        </p>
        <p className="mt-1 text-sm text-foreground-secondary">{detail}</p>
      </div>
    </div>
  )
}

function ConfirmBody({
  movie,
  league,
  dropCount,
  slotsFilled,
  dropsRemainingAfter,
}: {
  movie: Movie
  league: League
  dropCount: number
  slotsFilled: number
  dropsRemainingAfter: number
}) {
  return (
    <div className="space-y-4 p-4">
      {/* Drop allowance: the scarce thing being spent, shown as countable pips. */}
      <div className="rounded-lg border border-border bg-elevated/60 p-3">
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

      {/* Consequences */}
      <div>
        <p className="mb-2 text-sm font-medium text-foreground">What happens</p>
        <ul className="space-y-2">
          <Consequence icon={Film}>
            {movie.title} leaves your roster now, freeing a slot &mdash; you will be at{' '}
            {slotsFilled - 1}/{league.total_slots} filled.
          </Consequence>
          <Consequence icon={TrendingDown}>
            {movie.fantasy_points !== null
              ? `You give up its ${formatFantasyPoints(movie.fantasy_points)} pts.`
              : 'You give up whatever it scores when it opens, good or bad.'}
          </Consequence>
          <Consequence icon={Megaphone}>
            Everyone in the league is told it is available, and any team can bid on it.
          </Consequence>
        </ul>
      </div>

      <p className="alert alert-warning flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <span>This takes effect immediately and cannot be undone.</span>
      </p>
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
