'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
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
      className={`group cursor-pointer text-left transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none ${className}`}
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
          className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.06] motion-safe:group-focus-visible:scale-[1.06]"
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

function shortDate(releaseDate: string | null): string {
  return releaseDate ? formatDate(releaseDate) : 'TBA'
}

/** How the movie got here: the draft slot it filled, or what the bid cost. */
function acquisitionLabel(movie: MovieTimelineItem): string {
  return movie.source === 'draft'
    ? `Round ${movie.round}, pick ${movie.pick_number}`
    : `$${movie.amount_paid} pickup`
}

/** The next release leads the shelf with its title over the artwork. */
function NextUpHero({
  movie,
  onSelect,
}: {
  movie: MovieTimelineItem
  onSelect: (movie: MovieTimelineItem) => void
}) {
  return (
    <div className="w-40 flex-none sm:w-44" data-testid="next-up">
      <MovieButton
        movie={movie}
        onSelect={onSelect}
        className="relative block w-full rounded-xl shadow-[0_0_12px_rgba(201,162,39,0.14)] hover:shadow-glow-gold focus-visible:shadow-glow-gold"
      >
        <Poster
          movie={movie}
          sizes="(min-width: 640px) 176px, 160px"
          className="aspect-[2/3] w-full rounded-xl border border-gold/40 transition-colors group-hover:border-gold/70 group-focus-visible:border-gold/70"
          iconClassName="mb-16 h-[22px] w-[22px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(to_top,rgba(0,0,0,0.95),rgba(0,0,0,0.78)_40%,transparent_75%)]"
        />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="type-card line-clamp-3 break-words text-white">
            {movie.title}
          </div>
          <div className="type-meta mt-2 text-white/90">
            {shortDate(movie.release_date)}
          </div>
        </div>
      </MovieButton>
    </div>
  )
}

/** Shared with the league release board so the overview's sections match. */
export function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pb-2">
      <h3 className="type-section text-foreground">{title}</h3>
      <span className="type-meta type-numeric text-foreground-secondary">{count}</span>
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
    <div className="flex flex-none items-start gap-3" data-testid="upcoming-shelf">
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

  const { hero, upcoming, scored } = useMemo(() => {
    const scoredMovies = movies
      .filter((m) => m.status === 'scored')
      .sort((a, b) => (b.fantasy_points || 0) - (a.fantasy_points || 0))

    const unreleased = movies.filter((m) => m.status !== 'scored').sort(sortByDate)

    // Prefer a genuinely imminent release; otherwise lead with whatever is next.
    const imminent = unreleased.find((m) => m.status === 'releasing_soon')
    const heroMovie = imminent ?? unreleased[0] ?? null

    return {
      hero: heroMovie,
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
            <div key={i} className="aspect-[2/3] rounded-lg border border-border bg-elevated" />
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
        <>
          <SectionHeader title="Upcoming" count={upcoming.length + 1} />
          <div
            className="scrollbar-none flex items-start gap-4 overflow-x-auto px-4 pb-[18px] pt-2"
            data-testid="release-shelf"
          >
            <NextUpHero movie={hero} onSelect={setSelected} />
            {upcoming.length > 0 && <UpcomingShelf movies={upcoming} onSelect={setSelected} />}
          </div>
        </>
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
