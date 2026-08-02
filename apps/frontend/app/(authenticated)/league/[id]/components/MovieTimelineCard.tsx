import Image from 'next/image'
import type { MovieTimelineItem } from '@/types'

interface Props {
  movie: MovieTimelineItem
  onClick?: () => void
}

function getStatusIndicator(status: MovieTimelineItem['status']) {
  switch (status) {
    case 'scored':
      return { symbol: '●', className: 'text-foreground-muted' }
    case 'releasing_soon':
      return { symbol: '◐', className: 'text-gold animate-glow-pulse' }
    case 'upcoming':
      return { symbol: '○', className: 'text-foreground-muted' }
  }
}

function formatCountdown(releaseDate: string | null): string {
  if (!releaseDate) return 'TBD'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffMs = release.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'Released'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 30) return `${diffDays} days`
  if (diffDays <= 60) return '1 mo'
  if (diffDays <= 365) return `${Math.round(diffDays / 30)} mo`
  return 'TBD'
}

function formatFantasyPoints(points: number): string {
  const rounded = Math.round(points)
  return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

export default function MovieTimelineCard({ movie, onClick }: Props) {
  const indicator = getStatusIndicator(movie.status)
  const isScored = movie.status === 'scored'
  const hasFantasyPoints = movie.fantasy_points != null
  const isPositive = hasFantasyPoints && movie.fantasy_points! >= 0

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-32 group cursor-pointer transition-transform hover:scale-105 ${
        isScored ? 'opacity-80' : ''
      }`}
    >
      {/* Status Indicator */}
      <div className="flex justify-center mb-2">
        <span className={`text-xl ${indicator.className}`}>
          {indicator.symbol}
        </span>
      </div>

      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-elevated border border-border group-hover:border-gold/50 transition-colors">
        {movie.poster_url ? (
          <Image
            src={movie.poster_url}
            alt={movie.title}
            fill
            className="object-cover"
            sizes="128px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-foreground-muted">
            No Poster
          </div>
        )}

        {/* Hover Overlay with Scores */}
        {isScored && movie.scores && (
          <div className="absolute inset-0 bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
            <div className="text-xs text-foreground-muted mb-1">Scores</div>
            <div className="text-xs space-y-0.5">
              {movie.scores.imdb && (
                <div className={movie.scores.imdb < 40 ? 'text-crimson' : 'text-yellow-400'}>
                  IMDb: {movie.scores.imdb}
                </div>
              )}
              {movie.scores.rotten_tomatoes && (
                <div className={movie.scores.rotten_tomatoes < 40 ? 'text-crimson' : 'text-red-400'}>
                  RT: {movie.scores.rotten_tomatoes}%
                </div>
              )}
              {movie.scores.metacritic && (
                <div className={movie.scores.metacritic < 40 ? 'text-crimson' : 'text-green-400'}>
                  MC: {movie.scores.metacritic}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-medium text-foreground truncate text-center">
        {movie.title}
      </p>

      {/* Fantasy Points or Countdown */}
      <p className={`text-sm text-center font-semibold ${
        isScored
          ? hasFantasyPoints && isPositive
            ? 'text-gold'
            : hasFantasyPoints
              ? 'text-crimson'
              : 'text-foreground-muted'
          : 'text-foreground-muted font-normal'
      }`}>
        {isScored && hasFantasyPoints
          ? `${formatFantasyPoints(movie.fantasy_points!)} pts`
          : isScored
            ? 'Pending'
            : formatCountdown(movie.release_date)}
      </p>
    </button>
  )
}
