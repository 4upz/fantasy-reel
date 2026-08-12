'use client'

import Image from 'next/image'
import { Clapperboard, Clock, User, ExternalLink } from 'lucide-react'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'
import { getReleaseYear, formatRuntime } from '@/utils/date'

interface MovieDetailBodyProps {
  /** What is known before the details request lands, so the panel is never empty. */
  movie: TMDbSearchResult
  details: TMDbMovieDetails | null
  loading: boolean
}

/**
 * The movie detail panel shared by the discover page and the roster.
 *
 * Extracted from MovieDetailModal so the roster shows exactly the same details
 * a player sees when searching, rather than a second, drifting version of them.
 * Owns no dialog chrome: the caller supplies the overlay, the close control and
 * any actions, which is what lets the roster host it alongside a drop flow.
 */
export default function MovieDetailBody({ movie, details, loading }: MovieDetailBodyProps) {
  const displayData = details || movie
  const releaseYear = getReleaseYear(displayData.release_date)

  return (
    <>
      {/* Backdrop image */}
      {details?.backdrop_url && (
        <div className="relative h-48 sm:h-64 overflow-hidden">
          <Image
            src={details.backdrop_url}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
        </div>
      )}

      <div className={`p-6 sm:p-8 ${details?.backdrop_url ? '-mt-24 sm:-mt-32 relative' : ''}`}>
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Poster */}
          <div className="flex-shrink-0 mx-auto sm:mx-0">
            <div className="relative w-40 sm:w-48 rounded-lg overflow-hidden shadow-heavy border border-border">
              {displayData.poster_url ? (
                <div className="relative w-full aspect-[2/3]">
                  <Image
                    src={displayData.poster_url}
                    alt={displayData.title}
                    fill
                    sizes="192px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="w-full aspect-[2/3] bg-elevated flex items-center justify-center">
                  <Clapperboard className="w-16 h-16 text-foreground-muted" />
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
              {displayData.title}
              {releaseYear && (
                <span className="text-foreground-muted font-normal ml-2">({releaseYear})</span>
              )}
            </h2>

            {details?.tagline && (
              <p className="text-gold italic mt-2">&ldquo;{details.tagline}&rdquo;</p>
            )}

            <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
              {displayData.vote_average > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-gold text-lg">★</span>
                  <span className="text-foreground font-semibold">
                    {displayData.vote_average.toFixed(1)}
                  </span>
                  {details?.vote_count && (
                    <span className="text-foreground-muted">
                      ({details.vote_count.toLocaleString()} votes)
                    </span>
                  )}
                </div>
              )}

              {details?.runtime && (
                <div className="flex items-center gap-1.5 text-foreground-secondary">
                  <Clock className="w-4 h-4" />
                  <span>{formatRuntime(details.runtime)}</span>
                </div>
              )}

              {displayData.release_date && (
                <div className="text-foreground-secondary">
                  {new Date(displayData.release_date).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              )}
            </div>

            {details?.genres && details.genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {details.genres.map((genre) => (
                  <span
                    key={genre.id}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-elevated border border-border text-foreground-secondary"
                  >
                    {genre.name}
                  </span>
                ))}
              </div>
            )}

            {details?.director && (
              <p className="mt-4 text-sm text-foreground-secondary">
                <span className="text-foreground-muted">Directed by</span>{' '}
                <span className="text-foreground">{details.director}</span>
              </p>
            )}

            {displayData.overview && (
              <div className="mt-6">
                <h3 className="font-display font-semibold text-foreground mb-2">Overview</h3>
                <p className="text-foreground-secondary leading-relaxed">{displayData.overview}</p>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && details?.cast && details.cast.length > 0 && (
          <div className="mt-8">
            <h3 className="font-display font-semibold text-foreground mb-4">Top Cast</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              {details.cast.map((actor) => (
                <div key={actor.id} className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-elevated border border-border relative">
                    {actor.profile_url ? (
                      <Image
                        src={actor.profile_url}
                        alt={actor.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-foreground-muted">
                        <User className="w-8 h-8" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground truncate">{actor.name}</p>
                  <p className="text-xs text-foreground-muted truncate">{actor.character}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {details?.imdb_id && (
          <div className="mt-8 pt-6 border-t border-border">
            <a
              href={`https://www.imdb.com/title/${details.imdb_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-gold hover:text-gold-hover transition-colors"
            >
              View on IMDb
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}
      </div>
    </>
  )
}
