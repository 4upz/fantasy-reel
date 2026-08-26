'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useMovieDetails } from '@/hooks/useMovieDetails'
import { useFranchiseHistory } from '@/hooks/useFranchiseHistory'
import type { TMDbSearchResult } from '@/types'
import { WishlistToggle } from '@/components/WishlistToggle'
import FranchiseHistoryPanel from '@/app/components/FranchiseHistoryPanel'
import { CloseIcon, StarIcon, CalendarIcon, ClockIcon, CheckIcon, ExternalLinkIcon, UserIcon, SpinnerIcon, ClapperboardIcon } from './Icons'
import { formatReleaseDateFull, formatRuntime } from './utils'

const DESCRIPTION_CHAR_THRESHOLD = 200

interface Props {
  movie: TMDbSearchResult
  isMyTurn: boolean
  onClose: () => void
  onDraft: (tmdbId: number) => void
  picking?: boolean
}

export default function MovieQuickPreview({
  movie,
  isMyTurn,
  onClose,
  onDraft,
  picking,
}: Props) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  // A failed lookup is not worth an error state: the caller already knows the
  // title, poster and release date, so the panel still reads fine.
  const { details, isLoading: loading } = useMovieDetails(movie.tmdb_id)
  const { history: franchise } = useFranchiseHistory(movie.tmdb_id)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const displayData = details || movie
  const releaseYear = displayData.release_date
    ? new Date(displayData.release_date).getFullYear()
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/90 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl mx-4 my-8 sm:my-12 animate-slide-up">
        <div className="glass card overflow-hidden">
          {/* Backdrop Image */}
          {details?.backdrop_url ? (
            <div className="relative h-40 sm:h-56 overflow-hidden">
              <Image
                src={details.backdrop_url}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/60 to-transparent" />
            </div>
          ) : (
            <div className="h-20 bg-gradient-to-b from-elevated to-surface" />
          )}

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-background/60 backdrop-blur-sm border border-border text-foreground-muted hover:text-foreground hover:border-border-hover transition-all z-10"
          >
            <CloseIcon className="w-5 h-5" />
          </button>

          {/* Content */}
          <div className={details?.backdrop_url ? 'p-6 -mt-20 sm:-mt-28 relative' : 'p-6'}>
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Poster */}
              <div className="flex-shrink-0 mx-auto sm:mx-0">
                <div className="relative w-36 sm:w-44 rounded-xl overflow-hidden shadow-heavy border border-border">
                  {displayData.poster_url ? (
                    <div className="relative w-full aspect-[2/3]">
                      <Image
                        src={displayData.poster_url}
                        alt={displayData.title}
                        fill
                        sizes="176px"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-full aspect-[2/3] bg-elevated flex items-center justify-center">
                      <ClapperboardIcon className="w-12 h-12 text-foreground-muted" />
                    </div>
                  )}

                  {/* Wishlist Button */}
                  <WishlistToggle movie={movie} size="md" variant="overlay" className="absolute top-2 right-2" />
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {/* Title */}
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
                  {displayData.title}
                  {releaseYear && (
                    <span className="text-foreground-muted font-normal ml-2 text-xl">
                      ({releaseYear})
                    </span>
                  )}
                </h2>

                {/* Tagline */}
                {details?.tagline && (
                  <p className="text-gold italic mt-2 text-sm">&ldquo;{details.tagline}&rdquo;</p>
                )}

                {/* Meta Row */}
                <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
                  {/* Rating */}
                  {displayData.vote_average && displayData.vote_average > 0 && (
                    <div className="flex items-center gap-1.5">
                      <StarIcon className="w-5 h-5 text-gold" />
                      <span className="font-semibold text-foreground">
                        {displayData.vote_average.toFixed(1)}
                      </span>
                      {details?.vote_count && (
                        <span className="text-foreground-muted">
                          ({details.vote_count.toLocaleString()})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Runtime */}
                  {details?.runtime && (
                    <div className="flex items-center gap-1.5 text-foreground-secondary">
                      <ClockIcon className="w-4 h-4" />
                      <span>{formatRuntime(details.runtime)}</span>
                    </div>
                  )}

                  {/* Release Date */}
                  <div className="flex items-center gap-1.5 text-foreground-secondary">
                    <CalendarIcon className="w-4 h-4" />
                    <span>{formatReleaseDateFull(displayData.release_date)}</span>
                  </div>
                </div>

                {/* Genres */}
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

                {/* Director */}
                {details?.director && (
                  <p className="mt-4 text-sm">
                    <span className="text-foreground-muted">Directed by</span>{' '}
                    <span className="text-foreground font-medium">{details.director}</span>
                  </p>
                )}

                {/* Overview */}
                {displayData.overview && (
                  <div className="mt-4">
                    <div
                      className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                        isDescriptionExpanded ? 'max-h-[500px]' : 'max-h-[5.25rem]'
                      }`}
                    >
                      <p className="text-foreground-secondary text-sm leading-relaxed">
                        {displayData.overview}
                      </p>
                    </div>
                    {displayData.overview.length > DESCRIPTION_CHAR_THRESHOLD && (
                      <button
                        type="button"
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        className="mt-2 text-sm font-medium text-gold hover:text-gold-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        {isDescriptionExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Franchise history: the one place with room for the film-by-film
                line, so the grid and bid rows can stay at a single average. */}
            {franchise && (
              <FranchiseHistoryPanel
                history={franchise}
                movieTitle={displayData.title}
                movieReleaseDate={displayData.release_date}
                className="mt-6 animate-fade-in"
              />
            )}

            {/* Cast Section */}
            {loading ? (
              <div className="mt-6 flex items-center justify-center py-6">
                <SpinnerIcon className="w-6 h-6 text-gold" />
              </div>
            ) : (
              details?.cast &&
              details.cast.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-display font-semibold text-foreground text-sm mb-3">
                    Top Cast
                  </h3>
                  <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
                    {details.cast.slice(0, 6).map((actor) => (
                      <div key={actor.id} className="flex-shrink-0 text-center w-16">
                        <div className="w-14 h-14 mx-auto rounded-full overflow-hidden bg-elevated border border-border relative">
                          {actor.profile_url ? (
                            <Image
                              src={actor.profile_url}
                              alt={actor.name}
                              fill
                              sizes="56px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-foreground-muted">
                              <UserIcon className="w-6 h-6" />
                            </div>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-foreground truncate">
                          {actor.name}
                        </p>
                        <p className="text-xs text-foreground-muted truncate">{actor.character}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* Action Buttons */}
            <div className="mt-6 pt-6 border-t border-border flex flex-col sm:flex-row gap-3">
              {isMyTurn ? (
                <button
                  onClick={() => onDraft(movie.tmdb_id)}
                  disabled={picking}
                  className="btn btn-primary flex-1 py-3 text-base font-semibold"
                  data-testid="draft-movie-button"
                >
                  {picking ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon className="w-4 h-4" />
                      Drafting...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <CheckIcon className="w-5 h-5" />
                      Draft This Movie
                    </span>
                  )}
                </button>
              ) : (
                <div className="flex-1 py-3 px-4 bg-elevated rounded-lg border border-border text-center">
                  <span className="text-foreground-muted text-sm">Wait for your turn to draft</span>
                </div>
              )}

              <button onClick={onClose} className="btn btn-ghost py-3">
                Close
              </button>
            </div>

            {/* IMDb Link */}
            {details?.imdb_id && (
              <div className="mt-4 text-center">
                <a
                  href={`https://www.imdb.com/title/${details.imdb_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-gold hover:text-gold-hover transition-colors"
                >
                  View on IMDb
                  <ExternalLinkIcon className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
