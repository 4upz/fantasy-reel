'use client'

import MoviePoster from '@/app/components/MoviePoster'

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
      type="button"
      onClick={onClick}
      className="group relative flex h-full w-full cursor-pointer flex-col text-left rounded-xl overflow-hidden bg-surface border border-border transition-all duration-300 hover:border-gold/50 hover:shadow-glow-gold hover:-translate-y-1 focus-visible:border-gold animate-fade-in"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
    >
      {/* Poster container with aspect ratio. The card fills its grid row, so
          titles of one or two lines still leave every card the same height. */}
      <div className="relative aspect-[2/3] shrink-0 overflow-hidden bg-elevated">
        <MoviePoster
          src={movie.poster_url}
          alt=""
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          posterSize="w500"
          className="transition-transform duration-500 group-hover:scale-105"
        />

        {/* Gradient overlay on hover */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* View details prompt on hover */}
        <div aria-hidden="true" className="absolute bottom-4 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
          <span className="type-label text-gold">View details</span>
        </div>
      </div>

      {/* Movie info. A heading inside a button is not exposed as one, so the
          title is a span; the page's "Search results" heading leads the grid. */}
      <div className="flex flex-1 flex-col p-3">
        <span
          className="type-row-title text-foreground line-clamp-2 break-words group-hover:text-gold transition-colors"
          title={movie.title}
        >
          {movie.title}
        </span>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="type-body-sm text-foreground-secondary">
            <span className="sr-only">, </span>
            {releaseYear || 'TBA'}
          </span>
        </div>
      </div>
    </button>
  )
}
