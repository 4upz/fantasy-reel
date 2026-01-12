'use client'

import { useEffect, useState } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { TMDbSearchResult, TMDbMovieDetails } from '@/types'
import { CloseIcon, StarIcon, HeartIcon, CalendarIcon, ClockIcon, CheckIcon, ExternalLinkIcon, UserIcon, SpinnerIcon, ClapperboardIcon } from './Icons'
import { formatReleaseDateFull, formatRuntime } from './utils'

interface Props {
  movie: TMDbSearchResult
  isMyTurn: boolean
  isFavorite?: boolean
  onClose: () => void
  onDraft: (tmdbId: number) => void
  onToggleFavorite?: (tmdbId: number) => void
  picking?: boolean
}

export default function MovieQuickPreview({
  movie,
  isMyTurn,
  isFavorite,
  onClose,
  onDraft,
  onToggleFavorite,
  picking,
}: Props) {
  const [details, setDetails] = useState<TMDbMovieDetails | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDetails(): Promise<void> {
      setLoading(true)
      const { data } = await callEdgeFunction<TMDbMovieDetails>('get-movie-details', {
        body: { tmdb_id: movie.tmdb_id },
      })
      if (data) {
        setDetails(data)
      }
      setLoading(false)
    }
    fetchDetails()
  }, [movie.tmdb_id])

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
              <img
                src={details.backdrop_url}
                alt=""
                className="w-full h-full object-cover opacity-50"
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
                    <img
                      src={displayData.poster_url}
                      alt={displayData.title}
                      className="w-full aspect-[2/3] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-elevated flex items-center justify-center">
                      <ClapperboardIcon className="w-12 h-12 text-foreground-muted" />
                    </div>
                  )}

                  {/* Favorite Button */}
                  {onToggleFavorite && (
                    <button
                      onClick={() => onToggleFavorite(movie.tmdb_id)}
                      className={`absolute top-2 right-2 p-2 rounded-full transition-all ${
                        isFavorite
                          ? 'bg-crimson text-white'
                          : 'bg-background/70 backdrop-blur-sm text-foreground-muted hover:text-crimson'
                      }`}
                    >
                      <HeartIcon className="w-5 h-5" filled={isFavorite} />
                    </button>
                  )}
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
                    <p className="text-foreground-secondary text-sm leading-relaxed line-clamp-4">
                      {displayData.overview}
                    </p>
                  </div>
                )}
              </div>
            </div>

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
                        <div className="w-14 h-14 mx-auto rounded-full overflow-hidden bg-elevated border border-border">
                          {actor.profile_url ? (
                            <img
                              src={actor.profile_url}
                              alt={actor.name}
                              className="w-full h-full object-cover"
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
