'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Flame } from 'lucide-react'
import type { MovieTimelineItem, League } from '@/types'
import { formatDate } from '@/utils/date'
import { formatFantasyPoints } from '@/utils/scoring'

interface Props {
  movies: MovieTimelineItem[]
  leagueStatus: League['status']
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
          src={movie.poster_url}
          alt={movie.title}
          fill
          sizes={sizes}
          className="object-cover"
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

/** The hero's eyebrow. Only a genuinely imminent release earns the countdown. */
function heroEyebrow(movie: MovieTimelineItem, isImminent: boolean): string {
  if (!isImminent) return 'Next up'
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

/**
 * The movie that decides your week, given the whole width. Gold when it is
 * actually imminent; the fallback next-upcoming gets a neutral surface so the
 * treatment keeps meaning something.
 */
function NextUpHero({ movie, isImminent }: { movie: MovieTimelineItem; isImminent: boolean }) {
  return (
    <section
      className={`mx-4 mb-[18px] overflow-hidden rounded-[18px] p-3.5 ${
        isImminent
          ? 'border border-gold/30 bg-[linear-gradient(160deg,rgba(201,162,39,0.12),var(--color-surface)_60%)]'
          : 'border border-border bg-surface'
      }`}
      data-testid="next-up-hero"
    >
      <div
        className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${
          isImminent ? 'text-gold' : 'text-foreground-secondary'
        }`}
      >
        {isImminent && <Flame className="h-3.5 w-3.5" aria-hidden="true" />}
        {heroEyebrow(movie, isImminent)}
      </div>

      <div className="mt-3 flex items-center gap-3.5">
        <Poster
          movie={movie}
          sizes="76px"
          className="h-[114px] w-[76px] rounded-[10px]"
          iconClassName="h-[22px] w-[22px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-bold leading-[1.25] text-foreground">{movie.title}</h3>
          <p className="mt-1 text-[13px] text-foreground-secondary">
            {shortDate(movie.release_date)} · Round {movie.round}, pick {movie.pick_number}
          </p>
          <p className="mt-2 text-xs leading-[1.5] text-foreground-muted">
            Not rated yet. Scores land the night after release.
          </p>
        </div>
      </div>
    </section>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pb-2">
      <h3 className="font-display text-[15px] font-semibold text-foreground">{title}</h3>
      <span className="text-xs text-foreground-muted">{count}</span>
    </div>
  )
}

function UpcomingShelf({ movies }: { movies: MovieTimelineItem[] }) {
  return (
    <>
      <SectionHeader title="Upcoming" count={movies.length} />
      {/* Native horizontal scroll - no arrows on touch */}
      <div className="scrollbar-none flex gap-3 overflow-x-auto px-4 pb-[18px]" data-testid="upcoming-shelf">
        {movies.map((movie) => (
          <div key={movie.id} className="flex w-[118px] flex-none flex-col gap-[7px]">
            <Poster
              movie={movie}
              sizes="118px"
              className="h-[177px] w-[118px] rounded-xl border border-border"
              iconClassName="h-[22px] w-[22px]"
            />
            <div className="truncate text-[13px] font-semibold text-foreground" title={movie.title}>
              {movie.title}
            </div>
            <div className="text-[11px] text-foreground-muted">{shortDate(movie.release_date)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function ScoredList({ movies }: { movies: MovieTimelineItem[] }) {
  return (
    <>
      <SectionHeader title="Scored" count={movies.length} />
      <div className="flex flex-col gap-2 px-4" data-testid="scored-list">
        {movies.map((movie) => (
          <div
            key={movie.id}
            className="flex flex-none items-center gap-3 rounded-[14px] border border-border bg-surface px-3 py-[11px]"
          >
            <Poster
              movie={movie}
              sizes="38px"
              className="h-[57px] w-[38px] rounded-[7px]"
              iconClassName="h-[15px] w-[15px]"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={movie.title}>
                {movie.title}
              </div>
              <div className="mt-[3px] text-xs text-foreground-muted">
                {movie.combined_score != null ? `${Math.round(movie.combined_score)}% Tomatometer` : 'Not rated yet'}
              </div>
            </div>
            <div
              className={`flex-none font-display text-xl font-bold ${
                movie.fantasy_points == null
                  ? 'text-foreground-muted'
                  : movie.fantasy_points >= 0
                    ? 'text-gold'
                    : 'text-crimson'
              }`}
            >
              {formatFantasyPoints(movie.fantasy_points)}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function MovieGrid({ movies, leagueStatus }: Props) {
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
        <p className="text-foreground-muted">Your movies will appear here after the draft</p>
      </div>
    )
  }

  if (movies.length === 0) {
    return (
      <div className="card mx-4 p-8 text-center">
        <p className="text-foreground-muted">
          {leagueStatus === 'drafting'
            ? 'Draft your first movie to see it here'
            : 'No movies on your roster yet'}
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {hero && <NextUpHero movie={hero} isImminent={heroIsImminent} />}
      {upcoming.length > 0 && <UpcomingShelf movies={upcoming} />}
      {scored.length > 0 && <ScoredList movies={scored} />}
    </div>
  )
}
