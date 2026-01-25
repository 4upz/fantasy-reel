'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { Flame, Calendar, CheckCircle2 } from 'lucide-react'
import type { MovieTimelineItem, League } from '@/types'

interface Props {
  movies: MovieTimelineItem[]
  leagueStatus: League['status']
}

interface MovieCardProps {
  movie: MovieTimelineItem
  variant: 'releasing_soon' | 'upcoming' | 'scored'
}

function formatReleaseDate(releaseDate: string | null): string {
  if (!releaseDate) return 'TBD'
  const date = new Date(releaseDate)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCountdown(releaseDate: string | null): string {
  if (!releaseDate) return 'TBD'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffMs = release.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'Released'
  if (diffDays === 0) return 'Today!'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return `${diffDays} days`
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`
  return formatReleaseDate(releaseDate)
}

function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

function MovieCard({ movie, variant }: MovieCardProps) {
  const isReleasingSoon = variant === 'releasing_soon'
  const isScored = variant === 'scored'
  const hasFantasyPoints = movie.fantasy_points != null
  const isPositive = hasFantasyPoints && movie.fantasy_points! >= 0

  return (
    <div
      className={`group relative rounded-xl overflow-hidden transition-all duration-300 ${
        isReleasingSoon
          ? 'bg-gradient-to-br from-gold/10 to-surface border border-gold/30 hover:border-gold/50 hover:shadow-glow-gold'
          : 'bg-surface border border-border hover:border-border-hover hover:shadow-medium'
      }`}
    >
      <div className="flex gap-4 p-4">
        {/* Poster */}
        <div className="relative w-20 h-30 flex-shrink-0 rounded-lg overflow-hidden bg-elevated">
          {movie.poster_url ? (
            <Image
              src={movie.poster_url}
              alt={movie.title}
              width={80}
              height={120}
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-foreground-muted text-xs">
              No Poster
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-display font-semibold text-foreground truncate group-hover:text-gold transition-colors">
                {movie.title}
              </h4>
              {/* Bonus badges */}
              {movie.scoring_bonuses && (
                <div className="flex gap-1 flex-shrink-0">
                  {movie.scoring_bonuses.certified_fresh && (
                    <span className="px-1 py-0.5 text-[10px] font-bold bg-[#fa320a]/20 text-[#fa320a] border border-[#fa320a]/30 rounded" title="Certified Fresh +3">
                      CF
                    </span>
                  )}
                  {movie.scoring_bonuses.critical_darling && (
                    <span className="px-1 py-0.5 text-[10px] font-bold bg-gold/20 text-gold border border-gold/30 rounded" title="Critical Darling +5">
                      ★
                    </span>
                  )}
                  {movie.scoring_bonuses.critical_disaster && (
                    <span className="px-1 py-0.5 text-[10px] font-bold bg-crimson/20 text-crimson border border-crimson/30 rounded" title="Critical Disaster -5">
                      💀
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-foreground-muted mt-1">
              {isScored ? 'Released' : formatReleaseDate(movie.release_date)}
            </p>
          </div>

          {/* Score or Countdown */}
          <div className="mt-2">
            {isScored && hasFantasyPoints ? (
              <div className="flex items-center gap-3">
                <span className={`text-xl font-display font-bold ${isPositive ? 'text-gold' : 'text-crimson'}`}>
                  {formatFantasyPoints(movie.fantasy_points!)}
                  <span className="text-sm font-normal text-foreground-muted ml-1">pts</span>
                </span>
                <div className="flex gap-2 text-xs">
                  {movie.scores?.imdb && (
                    <span className={`px-1.5 py-0.5 rounded ${movie.scores.imdb < 40 ? 'bg-crimson/20 text-crimson' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      IMDb {movie.scores.imdb}
                    </span>
                  )}
                  {movie.scores?.rotten_tomatoes && (
                    <span className={`px-1.5 py-0.5 rounded ${movie.scores.rotten_tomatoes < 40 ? 'bg-crimson/20 text-crimson' : 'bg-red-500/20 text-red-400'}`}>
                      RT {movie.scores.rotten_tomatoes}%
                    </span>
                  )}
                  {movie.scores?.metacritic && (
                    <span className={`px-1.5 py-0.5 rounded ${movie.scores.metacritic < 40 ? 'bg-crimson/20 text-crimson' : 'bg-green-500/20 text-green-400'}`}>
                      MC {movie.scores.metacritic}
                    </span>
                  )}
                </div>
              </div>
            ) : isScored ? (
              <span className="text-sm text-foreground-muted">Pending scores</span>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                  isReleasingSoon ? 'text-gold' : 'text-foreground-secondary'
                }`}
              >
                {isReleasingSoon && <Flame className="w-4 h-4" />}
                {formatCountdown(movie.release_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Releasing Soon Pulse Effect */}
      {isReleasingSoon && (
        <div className="absolute top-3 right-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-gold" />
          </span>
        </div>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  icon: React.ReactNode
  count: number
  children: React.ReactNode
  variant?: 'default' | 'highlight'
}

function Section({ title, icon, count, children, variant = 'default' }: SectionProps) {
  const isHighlight = variant === 'highlight'

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className={isHighlight ? 'text-gold' : 'text-foreground-muted'}>{icon}</span>
        <h3 className={`font-display font-semibold ${isHighlight ? 'text-gold' : 'text-foreground'}`}>
          {title}
        </h3>
        <span className="text-sm text-foreground-muted">({count})</span>
      </div>
      {children}
    </div>
  )
}

export default function MovieGrid({ movies, leagueStatus }: Props) {
  // Memoize to prevent re-renders (rerender-memo optimization)
  // Must be called before any early returns to satisfy React hooks rules
  const { releasingSoon, upcoming, scored } = useMemo(() => {
    if (movies.length === 0) {
      return { releasingSoon: [], upcoming: [], scored: [] }
    }

    const sortByDate = (a: MovieTimelineItem, b: MovieTimelineItem) => {
      if (!a.release_date) return 1
      if (!b.release_date) return -1
      return new Date(a.release_date).getTime() - new Date(b.release_date).getTime()
    }

    const sortByScore = (a: MovieTimelineItem, b: MovieTimelineItem) => {
      return (b.fantasy_points || 0) - (a.fantasy_points || 0)
    }

    const releasing = movies.filter((m) => m.status === 'releasing_soon').sort(sortByDate)
    const upcomingMovies = movies.filter((m) => m.status === 'upcoming').sort(sortByDate)
    const scoredMovies = movies.filter((m) => m.status === 'scored').sort(sortByScore)

    return { releasingSoon: releasing, upcoming: upcomingMovies, scored: scoredMovies }
  }, [movies])

  // Empty state for setup phase
  if (leagueStatus === 'setup') {
    return (
      <div className="card p-8 text-center">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 mb-6 max-w-md mx-auto">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-lg bg-elevated border border-border animate-pulse"
            />
          ))}
        </div>
        <p className="text-foreground-muted">
          Your movies will appear here after the draft
        </p>
      </div>
    )
  }

  // Empty state for drafting phase with no picks yet
  if (movies.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-foreground-muted">
          {leagueStatus === 'drafting'
            ? 'Draft your first movie to see it here'
            : 'No movies on your roster yet'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Releasing Soon - Highlighted */}
      {releasingSoon.length > 0 && (
        <Section
          title="Releasing Soon"
          icon={<Flame className="w-5 h-5" />}
          count={releasingSoon.length}
          variant="highlight"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {releasingSoon.map((movie) => (
              <MovieCard key={movie.id} movie={movie} variant="releasing_soon" />
            ))}
          </div>
        </Section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Section
          title="Upcoming"
          icon={<Calendar className="w-5 h-5" />}
          count={upcoming.length}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcoming.map((movie) => (
              <MovieCard key={movie.id} movie={movie} variant="upcoming" />
            ))}
          </div>
        </Section>
      )}

      {/* Scored */}
      {scored.length > 0 && (
        <Section
          title="Scored"
          icon={<CheckCircle2 className="w-5 h-5" />}
          count={scored.length}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scored.map((movie) => (
              <MovieCard key={movie.id} movie={movie} variant="scored" />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
