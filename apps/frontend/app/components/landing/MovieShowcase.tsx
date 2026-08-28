'use client'

import Image from 'next/image'
import type { TMDbSearchResult } from '@/types'

interface Props {
  movies: TMDbSearchResult[]
}

function formatReleaseDate(dateStr: string | null): string {
  if (!dateStr) return 'TBA'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** @design-system Landing */
export default function MovieShowcase({ movies }: Props): React.ReactElement {
  return (
    <section className="py-24 px-6 bg-background">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-display text-3xl md:text-4xl font-bold text-center text-foreground mb-4">
          Now Drafting
        </h2>
        <p className="text-foreground-secondary text-center mb-12 max-w-2xl mx-auto">
          Coming soon to a league near you. The question is: will you call it?
        </p>

        <div className="showcase-container">
          <div className="showcase-fade-left" />
          <div className="showcase-fade-right" />

          <div className="showcase-scroll px-4">
            {movies.map((movie) => (
              <div key={movie.tmdb_id} className="showcase-poster-wrap">
                {movie.poster_url ? (
                  <Image
                    src={movie.poster_url}
                    alt={movie.title}
                    width={200}
                    height={300}
                    className="showcase-poster"
                  />
                ) : (
                  <div className="showcase-poster bg-surface flex items-center justify-center">
                    <span className="text-foreground-muted text-sm text-center px-4">
                      {movie.title}
                    </span>
                  </div>
                )}
                <div className="showcase-date">
                  {formatReleaseDate(movie.release_date)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
