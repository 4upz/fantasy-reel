'use client'

import Image from 'next/image'
import { Clapperboard } from 'lucide-react'
import type { TMDbSearchResult } from '@/types'
import { getReleaseYear } from '@/utils/date'

interface Props {
  movie: TMDbSearchResult
  onClick: () => void
  index: number
}

/** @design-system Movies */
export default function MovieCard({ movie, onClick, index }: Props) {
  const releaseYear = getReleaseYear(movie.release_date)

  return (
    <button
      onClick={onClick}
      className="group relative text-left w-full rounded-xl overflow-hidden bg-surface border border-border transition-all duration-300 hover:border-gold/50 hover:shadow-glow-gold hover:-translate-y-1 focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold-muted animate-fade-in"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
    >
      {/* Poster container with aspect ratio */}
      <div className="relative aspect-[2/3] overflow-hidden bg-elevated">
        {movie.poster_url ? (
          <Image
            src={movie.poster_url}
            alt={movie.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-foreground-muted">
            <Clapperboard className="w-12 h-12 mb-2" />
            <span className="text-xs">No poster</span>
          </div>
        )}

        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Rating badge */}
        {movie.vote_average > 0 && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border text-sm font-medium">
            <span className="text-gold">★</span>
            <span className="text-foreground">{movie.vote_average.toFixed(1)}</span>
          </div>
        )}

        {/* View details prompt on hover */}
        <div className="absolute bottom-4 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
          <span className="text-sm font-medium text-gold">View Details →</span>
        </div>
      </div>

      {/* Movie info */}
      <div className="p-3">
        <h3
          className="font-display font-semibold text-foreground truncate group-hover:text-gold transition-colors"
          title={movie.title}
        >
          {movie.title}
        </h3>
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm text-foreground-muted">
            {releaseYear || 'TBA'}
          </span>
        </div>
      </div>
    </button>
  )
}
