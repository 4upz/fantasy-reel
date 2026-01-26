'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { TMDbSearchResult } from '@/types'
import { StarIcon, HeartIcon, CheckIcon, ClapperboardIcon, PlusIcon, EyeIcon } from './Icons'
import { formatReleaseDateShort, getPopularityBadge, cn } from './utils'

interface Props {
  movie: TMDbSearchResult
  isSelected?: boolean
  isFavorite?: boolean
  isDrafted?: boolean
  onSelect: (movie: TMDbSearchResult) => void
  onToggleFavorite?: (tmdbId: number) => void
  onPreview?: (movie: TMDbSearchResult) => void
}

/**
 * DraftMovieCard - Movie card for draft selection
 *
 * UX Pattern:
 * - Clicking the card opens movie details/preview (most common user intent)
 * - Hover reveals two action buttons: "View Details" and "Draft"
 * - "Draft" button (gold) is the primary action for deliberate pick selection
 * - "View Details" button (secondary) provides quick access to preview
 */

export default function DraftMovieCard({
  movie,
  isSelected,
  isFavorite,
  isDrafted,
  onSelect,
  onToggleFavorite,
  onPreview,
}: Props) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const popularityBadge = getPopularityBadge(movie.popularity)

  function handleFavoriteClick(e: React.MouseEvent): void {
    e.stopPropagation()
    onToggleFavorite?.(movie.tmdb_id)
  }

  function handleCardClick(): void {
    // Card click opens preview (most common user intent)
    if (!isDrafted && onPreview) {
      onPreview(movie)
    }
  }

  function handleDraftClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (!isDrafted) {
      onSelect(movie)
    }
  }

  function handlePreviewClick(e: React.MouseEvent): void {
    e.stopPropagation()
    onPreview?.(movie)
  }

  const cardClasses = cn(
    'group relative rounded-xl overflow-hidden transition-all duration-300',
    isDrafted && 'opacity-40 cursor-not-allowed',
    !isDrafted && 'cursor-pointer hover:scale-[1.02] hover:z-10',
    isSelected ? 'ring-2 ring-gold shadow-glow-gold' : 'hover:shadow-medium'
  )

  return (
    <div onClick={handleCardClick} className={cardClasses}>
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
            <span className="text-xs text-foreground-muted">No poster</span>
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
                'px-2 py-0.5 rounded-full text-xs font-semibold shadow-md',
                popularityBadge.variant === 'solid'
                  ? 'bg-gold text-background'
                  : 'bg-gold-muted text-gold border border-gold'
              )}
            >
              {popularityBadge.label}
            </span>
          )}

          {/* Favorite Button */}
          {onToggleFavorite && !isDrafted && (
            <button
              onClick={handleFavoriteClick}
              className={cn(
                'p-1.5 rounded-full transition-all',
                isFavorite
                  ? 'bg-crimson text-white'
                  : 'bg-background/60 backdrop-blur-sm text-foreground-muted hover:text-crimson hover:bg-background/80'
              )}
            >
              <HeartIcon className="w-4 h-4" filled={isFavorite} />
            </button>
          )}
        </div>

        {/* Rating Badge */}
        {movie.vote_average && movie.vote_average > 0 && (
          <div className="absolute bottom-12 left-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg">
              <StarIcon className="w-3.5 h-3.5 text-gold" />
              <span className="text-sm font-semibold text-foreground">
                {movie.vote_average.toFixed(1)}
              </span>
            </div>
          </div>
        )}

        {/* Release Date Badge */}
        <div className="absolute bottom-12 right-2">
          <div className="px-2 py-1 bg-background/80 backdrop-blur-sm rounded-lg">
            <span className="text-xs font-medium text-foreground-secondary">
              {formatReleaseDateShort(movie.release_date)}
            </span>
          </div>
        </div>

        {/* Drafted Overlay */}
        {isDrafted && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <div className="px-3 py-1.5 bg-elevated border border-border rounded-lg">
              <span className="text-sm font-medium text-foreground-muted">Drafted</span>
            </div>
          </div>
        )}

        {/* Selected Checkmark */}
        {isSelected && (
          <div className="absolute top-2 right-2 w-7 h-7 bg-gold rounded-full flex items-center justify-center shadow-lg animate-fade-in">
            <CheckIcon className="w-4 h-4 text-background" />
          </div>
        )}

        {/* Hover Action Buttons */}
        {!isDrafted && (
          <div className="absolute inset-x-0 bottom-0 p-3 opacity-0 group-hover:opacity-100 transition-all duration-200">
            <div className="flex flex-col gap-2">
              {/* Draft Button - Primary Action */}
              <button
                onClick={handleDraftClick}
                className="w-full py-2.5 bg-gold hover:bg-gold-hover text-background text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-glow-gold"
              >
                <PlusIcon className="w-4 h-4" />
                Draft Movie
              </button>
              {/* View Details Button - Secondary Action */}
              {onPreview && (
                <button
                  onClick={handlePreviewClick}
                  className="w-full py-2 bg-surface/90 hover:bg-surface-hover text-foreground-secondary hover:text-foreground text-sm font-medium rounded-lg transition-all duration-200 backdrop-blur-sm border border-border hover:border-border-hover flex items-center justify-center gap-2"
                >
                  <EyeIcon className="w-4 h-4" />
                  View Details
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="p-3 bg-surface border-t border-border">
        <h3
          className="font-medium text-foreground truncate text-sm leading-tight"
          title={movie.title}
        >
          {movie.title}
        </h3>
        {movie.release_date && (
          <p className="text-xs text-foreground-muted mt-1">
            {new Date(movie.release_date).getFullYear()}
          </p>
        )}
      </div>

      {/* Selection Border */}
      {isSelected && (
        <div className="absolute inset-0 rounded-xl border-2 border-gold pointer-events-none" />
      )}
    </div>
  )
}
