import Image from 'next/image'
import { Film, Lock } from 'lucide-react'
import { formatCriticScore, formatFantasyPoints } from '@/utils/scoring'
import type { HoldingMovie } from '@/types'
import { getTmdbPosterUrl } from '../components/utils'

type RosterMovie = Pick<HoldingMovie, 'title' | 'poster_url' | 'fantasy_points' | 'combined_score'>

/** @design-system League */
export function RosterHeader({
  teamName,
  slotsFilled,
  totalSlots,
  remainingBudget,
  dropCount,
  dropLimit,
}: {
  teamName: string
  slotsFilled: number
  totalSlots: number
  remainingBudget: number
  dropCount: number
  dropLimit: number
}) {
  const dropsRemaining = dropLimit - dropCount

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="type-page text-foreground" data-testid="roster-team-name">
          {teamName}&apos;s Roster
        </h1>
        <p className="text-foreground-secondary">{slotsFilled}/{totalSlots} slots filled</p>
      </div>
      <div className="text-right" data-preview-focus="budget">
        <p className="type-body-sm text-foreground-secondary">Budget remaining</p>
        <p className="type-number-lg text-gold">${remainingBudget}</p>
        <p
          className={`type-body-sm ${dropsRemaining > 0 ? 'text-foreground-secondary' : 'text-crimson'}`}
          data-testid="drops-summary"
        >
          {dropsRemaining > 0
            ? `Drops: ${dropCount}/${dropLimit} used`
            : `No drops left (${dropCount}/${dropLimit} used)`}
        </p>
      </div>
    </div>
  )
}

/** @design-system League */
export function RosterPoster({
  movie,
  src,
  sizes = '(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw',
}: {
  movie: Pick<HoldingMovie, 'title' | 'poster_url'>
  src?: string
  sizes?: string
}) {
  const posterSrc = src ?? getTmdbPosterUrl(movie.poster_url, 'w342')

  if (!posterSrc) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Film className="w-12 h-12 text-foreground-muted" aria-hidden="true" />
      </div>
    )
  }

  return <Image src={posterSrc} alt={movie.title} fill sizes={sizes} className="object-cover" />
}

/** The same movie presentation serves playable rosters and read-only examples. */
/** @design-system League */
export function RosterMovieCard({
  movie,
  label,
  isLocked,
  onSelect,
  posterSrc,
  posterSizes,
  reviewFocus = false,
}: {
  movie: RosterMovie
  label: string
  isLocked: boolean
  onSelect?: () => void
  posterSrc?: string
  posterSizes?: string
  reviewFocus?: boolean
}) {
  const details = (
    <>
      <h3 className="type-row-title truncate text-foreground">{movie.title}</h3>
      <p className="type-meta text-foreground-secondary">{label}</p>
      {movie.fantasy_points !== null ? (
        <p className="type-number mt-1 flex items-baseline gap-1.5">
          <span className={`type-numeric ${movie.fantasy_points >= 0 ? 'text-success' : 'text-crimson'}`}>
            {formatFantasyPoints(movie.fantasy_points)} pts
          </span>
          {movie.combined_score !== null && (
            <span className="type-numeric type-meta text-foreground-secondary">
              {formatCriticScore(movie.combined_score)}
            </span>
          )}
        </p>
      ) : (
        <p className="type-meta mt-1 text-foreground-secondary">Pending</p>
      )}
    </>
  )

  const content = (
    <>
      <div className="relative aspect-[2/3] bg-elevated">
        <RosterPoster movie={movie} src={posterSrc} sizes={posterSizes} />
        {isLocked && (
          <span
            data-testid="roster-lock-badge"
            className="type-meta absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-foreground-secondary backdrop-blur-sm"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            Locked
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        {reviewFocus ? (
          <div className="w-fit max-w-full" data-preview-focus="reviews">
            {details}
          </div>
        ) : (
          details
        )}
      </div>
    </>
  )

  if (!onSelect) {
    return <article className="card flex flex-col overflow-hidden text-left">{content}</article>
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="roster-movie-card"
      data-locked={isLocked ? 'true' : 'false'}
      aria-label={`View ${movie.title}${isLocked ? ' (locked)' : ''}`}
      className="card card-interactive flex cursor-pointer flex-col overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {content}
    </button>
  )
}
