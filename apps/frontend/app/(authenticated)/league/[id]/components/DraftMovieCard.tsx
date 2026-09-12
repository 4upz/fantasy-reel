'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { FranchiseHistory, TMDbSearchResult } from '@/types'
import { WishlistToggle } from '@/components/WishlistToggle'
import { seriesName } from '@/utils/franchise'
import { ClapperboardIcon } from './Icons'
import { formatReleaseDateShort, getReleaseYear, getPopularityBadge, cn } from './utils'

interface Props {
  movie: TMDbSearchResult
  isDrafted?: boolean
  /** The series this movie continues, or null for a standalone / first film. */
  franchise?: FranchiseHistory | null
  onPreview: (movie: TMDbSearchResult) => void
}

/** Points are RT - 60, so 60 is where a series average turns from gold to crimson. */
const BREAK_EVEN = 60

/** @design-system Movies */
export default function DraftMovieCard({
  movie,
  isDrafted,
  franchise,
  onPreview,
}: Props) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const popularityBadge = getPopularityBadge(movie.popularity)
  const releaseYear = getReleaseYear(movie.release_date)
  const seriesLabel = franchise ? `${seriesName(franchise)} series` : null
  const seriesAverage = franchise?.average_rt ?? null

  const cardClasses = cn(
    'group relative rounded-xl overflow-hidden transition-[transform,box-shadow,opacity] duration-300 focus-within:ring-2 focus-within:ring-gold',
    isDrafted && 'opacity-60',
    !isDrafted && 'hover:scale-[1.02] hover:z-10 hover:shadow-medium motion-reduce:transform-none'
  )

  return (
    <div className={cardClasses} data-testid={`movie-card-${movie.tmdb_id}`}>
      <button
        type="button"
        onClick={() => onPreview(movie)}
        aria-label={`Preview ${movie.title}${isDrafted ? ' (drafted)' : ''}`}
        className="absolute inset-0 z-10 rounded-xl cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
        data-testid={`preview-movie-${movie.tmdb_id}`}
      />
      {/* Poster Container */}
      <div className="relative aspect-[2/3] bg-elevated">
        {/* Skeleton loader */}
        {!imageLoaded && !imageError && movie.poster_url && (
          <div className="absolute inset-0 bg-elevated animate-pulse">
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
          </div>
        )}

        {/* Poster Image */}
        {movie.poster_url && !imageError ? (
          <Image
            src={movie.poster_url}
            alt={movie.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={cn(
              'object-cover transition-opacity duration-300',
              imageLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-elevated">
            <ClapperboardIcon className="w-12 h-12 text-foreground-muted mb-2" />
            <span className="type-meta text-foreground-secondary">No poster</span>
          </div>
        )}

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

        {/* Top badges row */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
          {/* Popularity Badge */}
          {popularityBadge && (
            <span
              className={cn(
                'type-meta px-2 py-0.5 rounded-full shadow-md',
                popularityBadge.variant === 'solid'
                  ? 'bg-gold text-foreground-inverse'
                  : 'bg-gold-muted text-gold border border-gold'
              )}
            >
              {popularityBadge.label}
            </span>
          )}

          {/* Wishlist Button */}
          {!isDrafted && (
            <WishlistToggle movie={movie} size="sm" variant="overlay" className="relative z-20 ml-auto" />
          )}
        </div>

        {/* Release Date Badge */}
        <div className="absolute bottom-12 right-2">
          <div className="px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg">
            <span className="type-meta text-foreground-secondary">
              {formatReleaseDateShort(movie.release_date)}
            </span>
          </div>
        </div>

        {/* Drafted Overlay */}
        {isDrafted && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <div className="px-3 py-1.5 bg-elevated border border-border rounded-lg">
              <span className="type-label text-foreground-secondary">Drafted</span>
            </div>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="p-3 bg-surface border-t border-border">
        <h3
          className="type-row-title text-foreground truncate"
          title={movie.title}
        >
          {movie.title}
        </h3>
        {/* One line, words only: the card has no room for a chart, and the
            average is the one number that matters at a glance. The preview
            carries the film-by-film record. */}
        {(releaseYear || seriesLabel) && (
          <p className="type-meta text-foreground-secondary mt-1 truncate" data-testid="franchise-line">
            {releaseYear}
            {releaseYear && seriesLabel && ' · '}
            {seriesLabel}
            {seriesAverage != null && (
              <>
                {' · avg '}
                <span
                  className={cn(
                    'font-semibold',
                    seriesAverage >= BREAK_EVEN ? 'text-gold' : 'text-crimson'
                  )}
                >
                  {seriesAverage}%
                </span>
              </>
            )}
          </p>
        )}
      </div>

    </div>
  )
}
