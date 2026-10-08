'use client'

import { useState, useEffect, useMemo, useCallback, useId, useRef } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import { formatReleaseDateFull } from '@/utils/date'
import { isPreReleaseScore, isScoreLocked, pointsTone } from '@/utils/scoring'
import ScoreLockLabel from '@/app/components/ScoreLockLabel'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useMovieProjectionsByMovieId } from '@/hooks/useMovieProjections'
import { CounterpickProjection } from '@/app/components/projections/ProjectionChip'
import type { CounterpickOption, MovieProjection } from '@/types'
import { SpinnerIcon } from './Icons'

interface Props {
  leagueId: string
  teamId: string
  isMyTurn: boolean
  isPicking: boolean
  onPick: (movieId: string, option: CounterpickOption) => Promise<void>
  revision?: number
  draftRound?: boolean
  /**
   * Show scored movies as locked. Counterpick bids can't target a scored movie;
   * the draft's counterpick round is unaffected, so this is opt-in.
   */
  lockScored?: boolean
}

interface GroupedOptions {
  teamId: string
  teamName: string
  movies: CounterpickOption[]
}

export default function CounterpickPicker({
  leagueId,
  teamId,
  isMyTurn,
  isPicking,
  onPick,
  revision = 0,
  draftRound = false,
  lockScored = false,
}: Props) {
  const [options, setOptions] = useState<CounterpickOption[]>([])
  const [loading, setLoading] = useState(true)
  // Once the cards are on screen they stay there through refetches (every
  // counterpick and turn change), so a focused card is never torn down.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedOption, setSelectedOption] = useState<CounterpickOption | null>(null)
  const [retry, setRetry] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef<HTMLDivElement>(null)
  const turnNoteId = useId()

  // Fetch counterpick options when component mounts or when turn changes
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    async function fetchOptions() {
      setLoading(true)
      setError(null)

      try {
        const { data, error: fetchError } = await createClient().rpc('get_counterpick_options', {
          p_league_id: leagueId,
          p_team_id: teamId,
        }).abortSignal(controller.signal)
        if (cancelled) return
        if (fetchError) throw fetchError
        setOptions(data || [])
        setHasLoaded(true)
      } catch {
        if (cancelled) return
        setError('Failed to load counterpick options')
      } finally {
        clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      }
    }

    if (leagueId && teamId) {
      fetchOptions()
    }
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [leagueId, teamId, isMyTurn, revision, retry])

  // Group options by opponent team
  const groupedOptions = useMemo<GroupedOptions[]>(() => {
    const groups = new Map<string, GroupedOptions>()

    for (const option of options) {
      const existing = groups.get(option.owner_team_id)
      if (existing) {
        existing.movies.push(option)
      } else {
        groups.set(option.owner_team_id, {
          teamId: option.owner_team_id,
          teamName: option.owner_team_name,
          movies: [option],
        })
      }
    }

    // Sort groups alphabetically by team name
    return Array.from(groups.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    )
  }, [options])

  const projections = useMovieProjectionsByMovieId(options.map((option) => option.movie_id))
  const selectedProjection = selectedOption ? projections.get(selectedOption.movie_id) ?? null : null

  const isLocked = (option: CounterpickOption) => lockScored && isScoreLocked(option.fantasy_points)

  const selectedAvailable = options.some(option => option.movie_id === selectedOption?.movie_id)
  const confirmAction = useCallback(async () => {
    if (!selectedOption || !isMyTurn || isPicking) return
    if (!selectedAvailable) throw new Error('This movie is no longer available. Choose another counterpick.')
    await onPick(selectedOption.movie_id, selectedOption)
    setSelectedOption(null)
    // The confirmation bar holding focus is gone. In the draft the picker
    // stays, so land on its heading; a bid moves on to its own next step.
    if (draftRound) headingRef.current?.focus()
  }, [selectedOption, isMyTurn, isPicking, selectedAvailable, onPick, draftRound])
  const { execute: confirmPick, isLoading: confirming, error: pickError, reset: resetPickError } = useAsyncAction(confirmAction)

  const handleSelectOption = (option: CounterpickOption) => {
    if (!isMyTurn || isPicking || confirming || isLocked(option)) return
    resetPickError()
    setSelectedOption(option)
  }

  // The confirmation is the second step: take the user to it, or a screen
  // reader would never learn it appeared.
  const selectedId = selectedOption?.movie_id
  useEffect(() => {
    if (selectedId) selectionRef.current?.focus({ preventScroll: true })
  }, [selectedId])

  const handleCancelSelection = () => {
    if (isPicking || confirming) return
    const cancelledId = selectedOption?.movie_id
    setSelectedOption(null)
    resetPickError()
    if (cancelledId) {
      gridRef.current?.querySelector<HTMLElement>(`[data-counterpick-option="${cancelledId}"]`)?.focus()
    }
  }

  let body: React.ReactNode
  if (!hasLoaded && loading) {
    body = (
      <div className="text-center py-12" role="status">
        <SpinnerIcon className="w-8 h-8 text-gold mx-auto animate-spin" />
        <p className="text-foreground-secondary mt-3">Loading opponent movies...</p>
      </div>
    )
  } else if (error) {
    body = (
      <div className="alert alert-error" role="alert">
        {error}
        <button className="btn btn-secondary ml-3" onClick={() => setRetry(value => value + 1)}>Retry options</button>
      </div>
    )
  } else if (options.length === 0) {
    body = (
      <div className="text-center py-12 bg-elevated rounded-xl border border-border">
        <div className="flex justify-center mb-3">
          <Target className="w-10 h-10 text-foreground-muted" />
        </div>
        <p className="text-foreground-secondary">No movies available to counterpick</p>
        <p className="type-body-sm text-foreground-secondary mt-1">
          Opponent movies drop off this list once they&apos;re released or already targeted —
          nothing is left to counterpick right now
        </p>
        {draftRound && <p className="type-body-sm text-foreground-secondary mt-2">The league owner can end the remaining counterpicks and activate the league.</p>}
      </div>
    )
  } else {
    body = (
      <>
        {/* Instructions */}
        <div className="bg-elevated rounded-xl border border-border p-4">
          <div className="flex items-start gap-3">
            <Target className="w-5 h-5 text-gold flex-shrink-0 mt-0.5" />
            <div>
              <p className="type-body-sm text-foreground-secondary">
                Bet against an opponent&apos;s movie. If it scores below 60, you earn points equal to their loss. If it scores above 60, you lose points equal to their gain.
              </p>
            </div>
          </div>
        </div>

        {/* Grouped movie cards */}
        <div className="space-y-6" ref={gridRef} aria-busy={loading}>
          {groupedOptions.map((group) => (
            <div key={group.teamId} className="space-y-3">
              {/* Team header */}
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gold/20 rounded-full flex items-center justify-center" aria-hidden="true">
                  <span className="type-meta text-gold">
                    {group.teamName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <h4 className="type-label text-foreground-secondary">
                  {group.teamName}
                </h4>
                <span className="type-meta text-foreground-secondary">
                  ({group.movies.length} {group.movies.length === 1 ? 'movie' : 'movies'})
                </span>
              </div>

              {/* Movie cards grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {group.movies.map((option) => (
                  <CounterpickMovieCard
                    key={option.movie_id}
                    option={option}
                    isSelected={selectedOption?.movie_id === option.movie_id}
                    isSelectable={isMyTurn && !isPicking && !confirming}
                    isLocked={isLocked(option)}
                    describedBy={isMyTurn ? undefined : turnNoteId}
                    projection={projections.get(option.movie_id) ?? null}
                    onSelect={handleSelectOption}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Selection confirmation, right after the cards in reading order. */}
        {selectedOption && (
          <div className={`fixed ${draftRound ? 'bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-0' : 'bottom-0'} left-0 right-0 p-4 bg-surface/95 backdrop-blur-md border-t border-border shadow-heavy z-40 animate-slide-up motion-reduce:animate-none`} role="region" aria-label="Confirm selected counterpick">
            <div className="max-w-4xl mx-auto">
              {(pickError || !isMyTurn || !selectedAvailable) && <p className="text-error type-body-sm mb-3" role="alert">{pickError || (!isMyTurn ? 'It is no longer your turn.' : 'This movie is no longer available.')}</p>}
              <div className="flex flex-wrap items-center gap-3">
                {/* Selected movie preview */}
                <div ref={selectionRef} tabIndex={-1} className="flex items-center gap-3 flex-1 min-w-0 rounded-lg">
                  <div className="relative w-12 h-16 rounded-lg overflow-hidden border border-border bg-elevated">
                    <MoviePoster
                      src={selectedOption.poster_url}
                      alt=""
                      sizes="48px"
                      posterSize="w154"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="type-row-title text-foreground truncate">
                      <span className="sr-only">Selected for counterpick: </span>
                      {selectedOption.movie_title}
                    </p>
                    <p className="type-body-sm text-foreground-secondary">
                      Owned by {selectedOption.owner_team_name}
                    </p>
                    {selectedOption.release_date && (
                      <p className="type-meta text-foreground-secondary">
                        {formatReleaseDateFull(selectedOption.release_date)}
                      </p>
                    )}
                    {selectedProjection && selectedOption.fantasy_points === null && (
                      <CounterpickProjection projection={selectedProjection} className="mt-1" />
                    )}
                    <p className="sr-only">Confirm or cancel this counterpick.</p>
                  </div>
                </div>

                {/* Counterpick indicator */}
                <div className="hidden sm:flex items-center gap-2 px-3 py-2 bg-crimson/10 border border-crimson/30 rounded-lg" aria-hidden="true">
                  <Target className="w-4 h-4 text-crimson-text" />
                  <span className="type-label text-crimson-text">Counterpick</span>
                </div>

                {/* Actions */}
                <div className="flex w-full sm:w-auto gap-2">
                  <button
                    onClick={handleCancelSelection}
                    disabled={isPicking || confirming}
                    className="btn btn-ghost px-4"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { void confirmPick().catch(() => {}) }}
                    disabled={isPicking || confirming || !isMyTurn || !selectedAvailable}
                    className="btn btn-primary px-6"
                  >
                    {isPicking || confirming ? (
                      <span className="flex items-center gap-2">
                        <SpinnerIcon className="w-4 h-4" />
                        Picking...
                      </span>
                    ) : (
                      'Confirm Counterpick'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className={`space-y-6 ${selectedOption && isMyTurn ? 'pb-32 sm:pb-24' : ''}`}>
      {/* Header: present in every state, so focus has somewhere to land */}
      <div>
        <div className="flex items-center justify-between">
          <h3 ref={headingRef} tabIndex={-1} className="type-panel text-foreground">
            {isMyTurn ? 'Select movie to counterpick' : 'Opponent movies'}
          </h3>
          {isMyTurn && (
            <span className="badge bg-success-bg text-success border border-success">
              Your turn
            </span>
          )}
        </div>
        {!isMyTurn && (
          <p id={turnNoteId} className="type-body-sm text-foreground-secondary mt-1">
            Counterpicks unlock on your turn.
          </p>
        )}
      </div>

      {body}
    </div>
  )
}

interface CounterpickMovieCardProps {
  option: CounterpickOption
  isSelected: boolean
  isSelectable: boolean
  /** Already scored, so it can't be counterpicked by bid. */
  isLocked: boolean
  /** Why the card can't be chosen right now, when that is the turn. */
  describedBy?: string
  /** The target's projected score (Beta), or null when there is none to show. */
  projection: MovieProjection | null
  onSelect: (option: CounterpickOption) => void
}

function CounterpickMovieCard({
  option,
  isSelected,
  isSelectable: canSelect,
  isLocked,
  describedBy,
  projection,
  onSelect,
}: CounterpickMovieCardProps) {
  const titleId = useId()
  const pointsId = useId()
  const lockId = useId()
  const dateId = useId()
  const projectionId = useId()
  const points = option.fantasy_points
  const showProjection = projection !== null && points === null
  // Options are mostly unreleased, so a score here is usually a pre-release one.
  const isPreRelease = isPreReleaseScore(points, option.release_date)
  // `canSelect` is the turn. A locked movie is never selectable, and says why
  // itself rather than with the turn tooltip.
  const isSelectable = canSelect && !isLocked
  const description = [
    points !== null && pointsId,
    isLocked && lockId,
    option.release_date && dateId,
    showProjection && projectionId,
    !isLocked && describedBy,
  ].filter(Boolean).join(' ')

  return (
    // aria-disabled rather than disabled: an unavailable card stays focusable,
    // so a turn change never knocks focus out of the grid.
    <button
      type="button"
      onClick={() => onSelect(option)}
      aria-disabled={!isSelectable || undefined}
      aria-pressed={isSelected}
      aria-labelledby={titleId}
      aria-describedby={description || undefined}
      data-counterpick-option={option.movie_id}
      title={isLocked
        ? "Already scored, so it can't be counterpicked"
        : !canSelect ? "Wait for your turn to make a counterpick" : undefined}
      className={`relative group text-left rounded-xl overflow-hidden transition-all ${
        isSelected
          ? 'ring-2 ring-crimson shadow-glow-crimson scale-[1.02]'
          : isSelectable
          ? 'hover:ring-2 hover:ring-gold/50 hover:shadow-medium hover:scale-[1.01]'
          : 'opacity-60'
      } ${isSelectable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
    >
      {/* Poster */}
      <div className="aspect-[2/3] relative bg-elevated">
        <MoviePoster
          src={option.poster_url}
          alt=""
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          posterSize="w500"
        />

        {/* Hover overlay */}
        {isSelectable && (
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4" aria-hidden="true">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-crimson rounded-full">
              <Target className="w-3.5 h-3.5 text-white" />
              <span className="type-meta text-white">Counterpick</span>
            </div>
          </div>
        )}

        {/* Where the hover prompt would be: the card is too narrow to explain more */}
        {isLocked && (
          <div id={lockId} className="absolute inset-x-0 bottom-0 flex justify-center pb-3">
            <ScoreLockLabel className="type-meta px-2.5 py-1 rounded-full bg-background/85 backdrop-blur-sm" />
          </div>
        )}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 bg-crimson rounded-full flex items-center justify-center shadow-lg">
            <Target className="w-3.5 h-3.5 text-white" />
          </div>
        )}

        {/* Score badge if available */}
        {points !== null && (
          <div id={pointsId} className="type-meta absolute top-2 left-2 px-2 py-0.5 bg-background/80 backdrop-blur-sm rounded">
            <span aria-hidden="true" className={`type-numeric ${pointsTone(points, { preRelease: isPreRelease })}`}>
              {`${points >= 0 ? '+' : ''}${points} pts${isPreRelease ? ' at release' : ''}`}
            </span>
            <span className="sr-only">{`${points} points${isPreRelease ? ' at release' : ''}`}</span>
          </div>
        )}
      </div>

      {/* Movie info */}
      <div className="p-3 bg-surface border-t border-border">
        <p id={titleId} className="type-label text-foreground truncate">{option.movie_title}</p>
        {option.release_date && (
          <p id={dateId} className="type-meta text-foreground-secondary mt-0.5">
            {formatReleaseDateFull(option.release_date)}
          </p>
        )}
        {/* The card is the select button, so the chip only reads here (linked by aria-describedby). */}
        {showProjection && (
          <CounterpickProjection id={projectionId} projection={projection} interactive={false} className="mt-1.5" />
        )}
      </div>
    </button>
  )
}
