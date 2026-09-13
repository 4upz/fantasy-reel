'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Flame } from 'lucide-react'
import type { MovieTimelineItem, League } from '@/types'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'
import LeagueMovieModal from './LeagueMovieModal'
import { getTmdbPosterUrl } from './utils'

interface Props {
  movies: MovieTimelineItem[]
  leagueStatus: League['status']
}

/**
 * Opens a movie's details. Every row and tile on this page is one of these.
 *
 * `group` is what lets the poster and title inside react to a hover on the
 * whole target rather than only the few pixels under the pointer, and
 * `cursor-pointer` is not redundant: Tailwind v4's preflight leaves a button on
 * the browser's default arrow, so without it nothing here reads as clickable.
 */
function MovieButton({
  movie,
  onSelect,
  className,
  children,
}: {
  movie: MovieTimelineItem
  onSelect: (movie: MovieTimelineItem) => void
  className: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(movie)}
      data-testid="overview-movie-button"
      aria-label={`View ${movie.title}`}
      className={`group cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${className}`}
    >
      {children}
    </button>
  )
}

/** The film-strip placeholder shown wherever a poster is missing. */
function PosterFallback({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
      />
    </svg>
  )
}

function Poster({
  movie,
  sizes,
  className,
  iconClassName,
}: {
  movie: MovieTimelineItem
  sizes: string
  className: string
  iconClassName: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`relative flex flex-none items-center justify-center overflow-hidden bg-elevated ${className}`}>
      {movie.poster_url && !failed ? (
        <Image
          // Stored posters are TMDb paths, not URLs. Passing the raw path made
          // next/image 400 on every poster here and silently fall back to the
          // film-strip placeholder.
          src={getTmdbPosterUrl(movie.poster_url, 'w342')!}
          alt={movie.title}
          fill
          sizes={sizes}
          // The poster pushes very slightly past its frame on hover. The frame
          // already clips, so this reads as the artwork leaning forward rather
          // than the card moving - which keeps the horizontal shelf from
          // jittering the way a lift on the tile itself would.
          className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.06]"
          onError={() => setFailed(true)}
        />
      ) : (
        <PosterFallback className={`${iconClassName} text-foreground-muted`} />
      )}
    </div>
  )
}

function sortByDate(a: MovieTimelineItem, b: MovieTimelineItem) {
  if (!a.release_date) return 1
  if (!b.release_date) return -1
  return new Date(a.release_date).getTime() - new Date(b.release_date).getTime()
}

function daysUntil(releaseDate: string | null): number | null {
  if (!releaseDate) return null
  const diffMs = new Date(releaseDate).getTime() - Date.now()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/** Only an imminent release earns the countdown. */
function releaseCountdown(movie: MovieTimelineItem): string {
  const days = daysUntil(movie.release_date)
  if (days == null) return 'Releasing soon'
  if (days <= 0) return 'Releasing today'
  if (days === 1) return 'Releasing tomorrow'
  if (days <= 14) return `Releasing in ${days} days`
  return `Releasing in ${Math.ceil(days / 7)} weeks`
}

function shortDate(releaseDate: string | null): string {
  return releaseDate ? formatDate(releaseDate) : 'TBA'
}

/** How the movie got here: the draft slot it filled, or what the bid cost. */
function acquisitionLabel(movie: MovieTimelineItem): string {
  return movie.source === 'draft'
    ? `Round ${movie.round}, pick ${movie.pick_number}`
    : `$${movie.amount_paid} pickup`
}

/** Lead the shared shelf with a larger poster and title. */
function NextUpHero({
  movie,
  isImminent,
  onSelect,
}: {
  movie: MovieTimelineItem
  isImminent: boolean
  onSelect: (movie: MovieTimelineItem) => void
}) {
  return (
    <div className="w-40 flex-none min-[480px]:w-[360px]" data-testid="next-up">
      <SectionHeader title="Next up" className="pb-2" />
      <MovieButton
        movie={movie}
        onSelect={onSelect}
        className="flex w-full flex-col gap-[7px] rounded-xl min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4"
      >
        <Poster
          movie={movie}
          sizes="(min-width: 480px) 144px, 160px"
          className={`aspect-[2/3] w-full rounded-xl border transition-colors min-[480px]:w-36 ${
            isImminent
              ? 'border-gold/30 group-hover:border-gold/60'
              : 'border-border group-hover:border-border-hover'
          }`}
          iconClassName="h-[22px] w-[22px]"
        />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[7px]">
          <div className="type-card break-words text-foreground transition-colors group-hover:text-gold">
            {movie.title}
          </div>
          {isImminent && (
            <div className="type-meta flex items-center gap-1.5 text-gold">
              <Flame className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              {releaseCountdown(movie)}
            </div>
          )}
          <div className="type-meta text-foreground-secondary">{shortDate(movie.release_date)}</div>
          <div className="type-meta text-foreground-secondary">{acquisitionLabel(movie)}</div>
        </div>
      </MovieButton>
    </div>
  )
}

/** Shared with the league release board so the overview's sections match. */
export function SectionHeader({
  title,
  count,
  className = 'px-4 pb-2',
}: {
  title: string
  count?: number
  className?: string
}) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <h3 className="type-section text-foreground">{title}</h3>
      {count != null && <span className="type-meta type-numeric text-foreground-secondary">{count}</span>}
    </div>
  )
}

function UpcomingShelf({
  movies,
  onSelect,
}: {
  movies: MovieTimelineItem[]
  onSelect: (movie: MovieTimelineItem) => void
}) {
  return (
    <div className="flex-none">
      <SectionHeader title="Upcoming" count={movies.length} className="pb-2" />
      <div className="flex items-start gap-3" data-testid="upcoming-shelf">
        {movies.map((movie) => (
          <MovieButton
            key={movie.id}
            movie={movie}
            onSelect={onSelect}
            className="flex w-[118px] flex-none flex-col gap-[7px] rounded-xl"
          >
            <Poster
              movie={movie}
              sizes="118px"
              className="h-[177px] w-[118px] rounded-xl border border-border transition-colors group-hover:border-border-hover"
              iconClassName="h-[22px] w-[22px]"
            />
            <div
              className="type-row-title truncate text-foreground transition-colors group-hover:text-gold"
              title={movie.title}
            >
              {movie.title}
            </div>
            <div className="type-meta text-foreground-secondary">{shortDate(movie.release_date)}</div>
          </MovieButton>
        ))}
      </div>
    </div>
  )
}

function ScoredList({
  movies,
  onSelect,
}: {
  movies: MovieTimelineItem[]
  onSelect: (movie: MovieTimelineItem) => void
}) {
  return (
    <>
      <SectionHeader title="Scored" count={movies.length} />
      <div className="flex flex-col gap-2 px-4" data-testid="scored-list">
        {movies.map((movie) => (
          <MovieButton
            key={movie.id}
            movie={movie}
            onSelect={onSelect}
            className="flex flex-none items-center gap-3 rounded-[14px] border border-border bg-surface px-3 py-[11px] hover:border-border-hover hover:bg-surface-hover"
          >
            <Poster
              movie={movie}
              sizes="38px"
              className="h-[57px] w-[38px] rounded-[7px]"
              iconClassName="h-[15px] w-[15px]"
            />
            <div className="min-w-0 flex-1">
              <div
                className="type-row-title truncate text-foreground transition-colors group-hover:text-gold"
                title={movie.title}
              >
                {movie.title}
              </div>
              <div className="type-meta mt-[3px] text-foreground-secondary">
                {movie.combined_score != null ? `${Math.round(movie.combined_score)}% Tomatometer` : 'Not rated yet'}
              </div>
            </div>
            <div
              className={`type-number flex-none ${
                movie.fantasy_points == null
                  ? 'text-foreground-secondary'
                  : movie.fantasy_points >= 0
                    ? 'text-gold'
                    : 'text-crimson'
              }`}
            >
              {formatFantasyPoints(movie.fantasy_points)}
            </div>
          </MovieButton>
        ))}
      </div>
    </>
  )
}

export default function MovieGrid({ movies, leagueStatus }: Props) {
  const [selected, setSelected] = useState<MovieTimelineItem | null>(null)

  const { hero, heroIsImminent, upcoming, scored } = useMemo(() => {
    const scoredMovies = movies
      .filter((m) => m.status === 'scored')
      .sort((a, b) => (b.fantasy_points || 0) - (a.fantasy_points || 0))

    const unreleased = movies.filter((m) => m.status !== 'scored').sort(sortByDate)

    // Prefer a genuinely imminent release; otherwise lead with whatever is next.
    const imminent = unreleased.find((m) => m.status === 'releasing_soon')
    const heroMovie = imminent ?? unreleased[0] ?? null

    return {
      hero: heroMovie,
      heroIsImminent: imminent != null,
      // Everything still unreleased that is not already the hero
      upcoming: unreleased.filter((m) => m.id !== heroMovie?.id),
      scored: scoredMovies,
    }
  }, [movies])

  if (leagueStatus === 'setup') {
    return (
      <div className="card mx-4 p-8 text-center">
        <div className="mx-auto mb-6 grid max-w-md grid-cols-3 gap-4 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-lg border border-border bg-elevated" />
          ))}
        </div>
        <p className="text-foreground-secondary">Your movies will appear here after the draft</p>
      </div>
    )
  }

  if (movies.length === 0) {
    return (
      <div className="card mx-4 p-8 text-center">
        <p className="text-foreground-secondary">
          {leagueStatus === 'drafting'
            ? 'Draft your first movie to see it here'
            : 'No movies on your roster yet'}
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {hero && (
        <div
          className="scrollbar-none flex items-start gap-6 overflow-x-auto px-4 pb-[18px] pt-1"
          data-testid="release-shelf"
        >
          <NextUpHero movie={hero} isImminent={heroIsImminent} onSelect={setSelected} />
          {upcoming.length > 0 && <UpcomingShelf movies={upcoming} onSelect={setSelected} />}
        </div>
      )}
      {scored.length > 0 && <ScoredList movies={scored} onSelect={setSelected} />}

      {/* Read-only here. Managing a holding is the roster's job, so the overview
          opens a movie to look at it rather than duplicating the drop flow. */}
      {selected && (
        <LeagueMovieModal
          movie={selected}
          contextHeading="On your roster"
          contextLabel={acquisitionLabel(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
