'use client'

import { useCallback, useId, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { useModalDialog } from '@/hooks/useModalDialog'
import Image from 'next/image'
import MoviePoster from '@/app/components/MoviePoster'
import { useMovieDetails } from '@/hooks/useMovieDetails'
import { useFranchiseHistory } from '@/hooks/useFranchiseHistory'
import type { TMDbSearchResult } from '@/types'
import { WishlistToggle } from '@/components/WishlistToggle'
import FranchiseHistoryPanel from '@/app/components/FranchiseHistoryPanel'
import { CloseIcon, CalendarIcon, ClockIcon, CheckIcon, ExternalLinkIcon, UserIcon, SpinnerIcon } from './Icons'
import { formatReleaseDateFull, formatRuntime, getReleaseYear } from './utils'

const DESCRIPTION_CHAR_THRESHOLD = 200

interface Props {
  movie: TMDbSearchResult
  isMyTurn: boolean
  seasonYear: number
  isDrafted?: boolean
  unavailableReason?: string | null
  error?: string | null
  onClose: () => void
  onDraft: (tmdbId: number) => Promise<void>
  picking?: boolean
}

export default function MovieQuickPreview({
  movie,
  isMyTurn,
  seasonYear,
  isDrafted = false,
  unavailableReason,
  error,
  onClose,
  onDraft,
  picking,
}: Props) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const titleId = useId()
  const availabilityId = useId()
  const { mutate } = useSWRConfig()
  const { details, isLoading: loading, error: detailsError } = useMovieDetails(movie.tmdb_id)
  const { history: franchise } = useFranchiseHistory(movie.tmdb_id)
  const displayData = details || movie
  const releaseYear = getReleaseYear(displayData.release_date)
  const detailsReleaseYear = getReleaseYear(details?.release_date ?? null)

  let metadataIssue: string | null = null
  if (!details) metadataIssue = loading ? 'Checking movie availability…' : 'Movie details could not be loaded. Retry to check availability.'
  else if (details.tmdb_id !== movie.tmdb_id || detailsReleaseYear == null) metadataIssue = 'A confirmed release date is needed before this movie can be drafted.'
  else if (detailsReleaseYear < seasonYear) metadataIssue = 'This movie was released in a previous season.'
  else if (details.release_date! < new Date().toISOString().slice(0, 10)) metadataIssue = 'This movie has already been released.'
  else if (details.status === 'Canceled') metadataIssue = 'This movie is not available for drafting.'

  const disabledReason = isDrafted ? 'This movie has already been drafted.'
    : unavailableReason || (!isMyTurn ? 'Wait for your turn to draft.' : metadataIssue)
  const draftAction = useCallback(async () => {
    if (disabledReason) throw new Error(disabledReason)
    await onDraft(movie.tmdb_id)
  }, [disabledReason, movie.tmdb_id, onDraft])
  const { execute: draft, isLoading: submitting, error: submitError } = useAsyncAction(draftAction)
  const retryAction = useCallback(async () => {
    await mutate(['get-movie-details', movie.tmdb_id])
  }, [mutate, movie.tmdb_id])
  const { execute: retryDetails, isLoading: retrying } = useAsyncAction(retryAction)
  const busy = Boolean(picking) || submitting
  const { dialogRef, requestClose } = useModalDialog(onClose, busy)
  const visibleError = error || submitError
  const canRetryDetails = !loading && Boolean(detailsError || !details || details.tmdb_id !== movie.tmdb_id || detailsReleaseYear == null)

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={availabilityId}
      aria-modal="true"
      data-testid="movie-quick-preview"
      onClick={event => { if (event.target === event.currentTarget) requestClose() }}
      className="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none border-0 bg-transparent p-4 text-foreground backdrop:bg-background/90 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col animate-slide-up motion-reduce:animate-none">
        <div className="glass card flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 overflow-y-auto overscroll-contain" data-testid="movie-preview-scroll">
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
              onClick={requestClose}
              disabled={busy}
              aria-label="Close movie preview"
              type="button"
              className="absolute top-3 right-3 p-3 rounded-full bg-background/60 backdrop-blur-sm border border-border text-foreground-secondary hover:text-foreground hover:border-border-hover transition-colors z-10 focus-visible:ring-2 focus-visible:ring-gold"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            {/* Content */}
            <div className={details?.backdrop_url ? 'p-6 -mt-20 sm:-mt-28 relative' : 'p-6'}>
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Poster */}
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="relative w-36 sm:w-44 rounded-xl overflow-hidden shadow-heavy border border-border">
                    <div className="relative w-full aspect-[2/3] bg-elevated">
                      <MoviePoster
                        src={displayData.poster_url}
                        alt={displayData.title}
                        sizes="(min-width: 640px) 176px, 144px"
                        posterSize="w500"
                        priority
                      />
                    </div>

                    {/* Wishlist Button */}
                    <WishlistToggle movie={movie} size="md" variant="overlay" className="absolute top-2 right-2" />
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {/* Title */}
                  <h2 id={titleId} tabIndex={-1} data-dialog-initial-focus className="type-panel break-words text-foreground focus:outline-none">
                    {displayData.title}
                    {releaseYear && (
                      <span className="type-body text-foreground-secondary ml-2">
                        ({releaseYear})
                      </span>
                    )}
                  </h2>

                  {/* Tagline */}
                  {details?.tagline && (
                    <p className="type-body-sm text-gold italic mt-2">&ldquo;{details.tagline}&rdquo;</p>
                  )}

                  {/* Meta Row */}
                  <div className="type-body-sm flex flex-wrap items-center gap-4 mt-4">
                    {/* Runtime */}
                    {details?.runtime != null && details.runtime > 0 && (
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
                          className="type-meta px-3 py-1 rounded-full bg-elevated border border-border text-foreground-secondary"
                        >
                          {genre.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Director */}
                  {details?.director && (
                    <p className="type-body-sm mt-4">
                      <span className="text-foreground-secondary">Directed by</span>{' '}
                      <span className="text-foreground font-medium">{details.director}</span>
                    </p>
                  )}

                  {/* Overview */}
                  {displayData.overview && (
                    <div className="mt-4">
                      <div
                        className={isDescriptionExpanded ? '' : 'line-clamp-3'}
                      >
                        <p className="type-body-sm text-foreground-secondary">
                          {displayData.overview}
                        </p>
                      </div>
                      {displayData.overview.length > DESCRIPTION_CHAR_THRESHOLD && (
                        <button
                          type="button"
                          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                          aria-expanded={isDescriptionExpanded}
                          className="type-control mt-2 text-gold hover:text-gold-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
                    <h3 className="type-label text-foreground mb-3">
                      Top cast
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
                              <div className="w-full h-full flex items-center justify-center text-foreground-secondary">
                                <UserIcon className="w-6 h-6" />
                              </div>
                            )}
                          </div>
                          <p className="type-meta mt-1.5 text-foreground truncate">
                            {actor.name}
                          </p>
                          <p className="type-meta text-foreground-secondary truncate">{actor.character}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}

              {/* IMDb Link */}
              {details?.imdb_id && (
                <div className="mt-4 text-center">
                  <a
                    href={`https://www.imdb.com/title/${details.imdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="type-body-sm inline-flex items-center gap-1.5 text-gold hover:text-gold-hover transition-colors"
                  >
                    View on IMDb
                    <ExternalLinkIcon className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="movie-preview-actions">
            <p className="type-row-title mb-2 line-clamp-2 text-foreground" title={displayData.title}>{displayData.title}</p>
            {visibleError && <p className="alert alert-error type-body-sm mb-3" role="alert">{visibleError}</p>}
            <p id={availabilityId} className="type-body-sm mb-3 text-foreground-secondary" role="status" aria-live="polite">
              {busy ? 'Submitting your pick…' : disabledReason || 'Available to draft. Eligibility is checked when you submit.'}
            </p>
            {canRetryDetails && (
              <button
                type="button"
                onClick={() => { void retryDetails().catch(() => {}) }}
                disabled={retrying || busy}
                className="btn btn-secondary mb-3"
                data-testid="retry-movie-details"
              >
                {retrying ? 'Checking details…' : 'Retry movie details'}
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { void draft().catch(() => {}) }}
                disabled={busy || Boolean(disabledReason)}
                aria-busy={busy}
                aria-describedby={availabilityId}
                className="btn btn-primary flex-1 py-3 type-control"
                data-testid="draft-movie-button"
              >
                <span className="flex items-center justify-center gap-2">
                  {busy ? <SpinnerIcon className="w-4 h-4" /> : <CheckIcon className="w-5 h-5" />}
                  {busy ? 'Drafting…' : 'Draft this movie'}
                </span>
              </button>
              <button type="button" onClick={requestClose} disabled={busy} className="btn btn-ghost py-3">Close</button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  )
}
