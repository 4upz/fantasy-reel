'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Clapperboard, Clock, User, ExternalLink, ChevronDown } from 'lucide-react'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'
import { getReleaseYear, formatRuntime } from '@/utils/date'

interface MovieDetailBodyProps {
  /** What is known before the details request lands, so the panel is never empty. */
  movie: TMDbSearchResult
  details: TMDbMovieDetails | null
  loading: boolean
  /**
   * What the caller can do with this movie, rendered high in the panel - right
   * under the title and headline facts - so a long synopsis never pushes the
   * controls below the fold on a phone.
   */
  actions?: React.ReactNode
  /**
   * Collapse the cast behind a disclosure, closed by default. On in the league
   * view, where the panel is a step in a task and the cast is context rather
   * than the point; off on discover, where browsing the cast IS the point.
   */
  collapsibleCast?: boolean
}

/**
 * The movie detail panel shared by the discover page and the roster.
 *
 * Extracted from MovieDetailModal so the roster shows exactly the same details
 * a player sees when searching, rather than a second, drifting version of them.
 * Owns no dialog chrome: the caller supplies the overlay, the close control and
 * any actions, which is what lets the roster host it alongside a drop flow.
 */
export default function MovieDetailBody({
  movie,
  details,
  loading,
  actions,
  collapsibleCast = false,
}: MovieDetailBodyProps) {
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

            {/* Sits above genres, director and synopsis on purpose: on a phone
                the info column is the whole screen, and anything below the
                overview is a scroll away. */}
            {actions && <div className="mt-5">{actions}</div>}

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
          <CastSection cast={details.cast} collapsible={collapsibleCast} />
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

type CastMember = NonNullable<TMDbMovieDetails['cast']>[number]

/**
 * Top billing, optionally behind a disclosure.
 *
 * Ten headshots are a lot of vertical space to put between a player and the
 * rest of a panel they opened to act in, so the league view starts it closed
 * and says how many are inside rather than hiding that anything is there.
 */
function CastSection({ cast, collapsible }: { cast: CastMember[]; collapsible: boolean }) {
  const [open, setOpen] = useState(!collapsible)

  return (
    <div className="mt-8">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          data-testid="cast-toggle"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2 text-left transition-colors hover:border-border-hover"
        >
          <span className="font-display font-semibold text-foreground">
            Top Cast{' '}
            <span className="font-body text-sm font-normal text-foreground-muted">
              ({cast.length})
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 flex-none text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <h3 className="font-display font-semibold text-foreground mb-4">Top Cast</h3>
      )}

      {open && (
        <div
          data-testid="cast-list"
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 ${collapsible ? 'mt-4' : ''}`}
        >
          {cast.map((actor) => (
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
      )}
    </div>
  )
}
