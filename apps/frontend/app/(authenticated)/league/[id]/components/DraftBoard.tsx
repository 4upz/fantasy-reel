'use client'

import { useState, useMemo } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import MoviePicker from './MoviePicker'
import DraftProgressRing from './DraftProgressRing'
import PickOrderQueue from './PickOrderQueue'
import { ClapperboardIcon, ArrowUpIcon, ClockIcon } from './Icons'
import type { League, ParticipantWithTeam, DraftPickWithDetails, NextPickInfo, TMDbSearchResult } from '@/types'

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  currentUserId: string
  favoriteMovieIds?: Set<number>
  onPickMade: () => void
  onToggleFavorite?: (tmdbId: number) => void
}

const TOTAL_ROUNDS = 5

export default function DraftBoard({
  league,
  participants,
  draftPicks,
  currentUserId,
  favoriteMovieIds = new Set(),
  onPickMade,
  onToggleFavorite,
}: Props) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalParticipants = participants.length
  const totalPicks = totalParticipants * TOTAL_ROUNDS
  const picksMade = draftPicks.length

  // Calculate whose turn it is
  const nextPick = useMemo<NextPickInfo | null>(() => {
    if (totalParticipants === 0) return null

    // Draft is complete
    if (picksMade >= totalPicks) return null

    const nextRound = Math.floor(picksMade / totalParticipants) + 1
    const pickInRound = (picksMade % totalParticipants) + 1

    // Snake draft: reverse order on even rounds
    let draftOrder: number
    if (nextRound % 2 === 0) {
      draftOrder = totalParticipants - pickInRound + 1
    } else {
      draftOrder = pickInRound
    }

    const nextParticipant = participants.find((p) => p.draft_order === draftOrder)
    if (!nextParticipant || !nextParticipant.teams) return null

    return {
      round: nextRound,
      pick_number: pickInRound,
      team_id: nextParticipant.teams.id,
      participant_id: nextParticipant.id,
      user_id: nextParticipant.user_id,
    }
  }, [participants, picksMade, totalParticipants, totalPicks])

  const isMyTurn = nextPick?.user_id === currentUserId
  const isDraftComplete = league.status === 'drafting' && !nextPick

  // Set of drafted tmdb_ids (movies that have been picked)
  const draftedTmdbIds = useMemo(() => {
    return new Set(
      draftPicks
        .map((pick) => pick.movies?.tmdb_id)
        .filter((id): id is number => id !== undefined && id !== null)
    )
  }, [draftPicks])

  // Map of user_id to team name for display
  const teamNamesByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const participant of participants) {
      map.set(participant.user_id, participant.teams?.name || 'Unknown Team')
    }
    return map
  }, [participants])

  async function handleDraftPick(tmdbId: number, movieData: TMDbSearchResult): Promise<void> {
    setPicking(true)
    setError(null)

    const { error: pickError } = await callEdgeFunction('draft-pick', {
      body: {
        league_id: league.id,
        tmdb_id: tmdbId,
        movie_data: {
          title: movieData.title,
          overview: movieData.overview,
          poster_url: movieData.poster_url,
          release_date: movieData.release_date,
          vote_average: movieData.vote_average,
          popularity: movieData.popularity,
          genre_ids: movieData.genre_ids,
        },
      },
    })

    if (pickError) {
      setError(pickError)
    } else {
      onPickMade()
    }

    setPicking(false)
  }

  function getTeamName(userId: string): string {
    return teamNamesByUserId.get(userId) || 'Unknown Team'
  }

  // Render different views based on league status
  if (league.status === 'setup') {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-semibold font-display text-foreground mb-4">Draft Board</h2>
        <div className="text-center py-8">
          <div className="flex justify-center mb-4">
            <ClapperboardIcon className="w-16 h-16 text-foreground-muted" />
          </div>
          <p className="text-foreground-secondary mb-2">The draft hasn&apos;t started yet.</p>
          <p className="text-sm text-foreground-muted">
            Waiting for the league owner to start the draft.
          </p>
          <p className="text-sm text-foreground-muted mt-2">
            {participants.length} / {league.max_participants} participants joined
          </p>
        </div>
      </div>
    )
  }

  if (league.status === 'active' || league.status === 'completed') {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold font-display text-foreground">Draft Results</h2>
          <DraftProgressRing current={picksMade} total={totalPicks} size="sm" showLabel={false} />
        </div>
        <p className="text-foreground-secondary mb-4">The draft is complete!</p>
        <PickHistory draftPicks={draftPicks} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Draft Header Card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6">
          {/* Left: Title and Status */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-semibold font-display text-foreground">Draft Board</h2>
            </div>

            {/* Current Turn Indicator */}
            {nextPick && (
              <div
                className={`p-4 rounded-xl border-2 transition-all ${
                  isMyTurn
                    ? 'bg-success-bg border-success shadow-glow-gold animate-glow-pulse'
                    : 'bg-elevated border-border'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      isMyTurn ? 'bg-success text-background' : 'bg-gold text-background'
                    }`}
                  >
                    {isMyTurn ? (
                      <ArrowUpIcon className="w-6 h-6" />
                    ) : (
                      <ClockIcon className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-foreground-muted">
                      Round {nextPick.round}, Pick {nextPick.pick_number}
                    </p>
                    <p
                      className={`text-lg font-semibold ${
                        isMyTurn ? 'text-success' : 'text-foreground'
                      }`}
                    >
                      {isMyTurn ? "It's your turn!" : `${getTeamName(nextPick.user_id)}'s pick`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isDraftComplete && (
              <div className="p-4 rounded-xl bg-info-bg border-2 border-info">
                <p className="text-info font-semibold text-lg">
                  Draft complete! Finalizing results...
                </p>
              </div>
            )}
          </div>

          {/* Right: Progress Ring */}
          <div className="flex-shrink-0">
            <DraftProgressRing current={picksMade} total={totalPicks} size="lg" />
          </div>
        </div>

        {/* Pick Order Queue */}
        {nextPick && (
          <div className="mt-6 pt-6 border-t border-border">
            <PickOrderQueue
              participants={participants}
              currentPickIndex={picksMade}
              currentUserId={currentUserId}
              rounds={TOTAL_ROUNDS}
            />
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Movie Picker - Always visible for browsing, but only pickable on your turn */}
      <div className="card p-6">
        <MoviePicker
          draftedTmdbIds={draftedTmdbIds}
          favoriteMovieIds={favoriteMovieIds}
          isMyTurn={isMyTurn}
          picking={picking}
          onPick={handleDraftPick}
          onToggleFavorite={onToggleFavorite}
        />
      </div>

      {/* Pick History */}
      {draftPicks.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg font-display font-semibold text-foreground mb-4">
            Pick History
          </h3>
          <PickHistory draftPicks={draftPicks} />
        </div>
      )}
    </div>
  )
}

function PickHistory({ draftPicks }: { draftPicks: DraftPickWithDetails[] }) {
  if (draftPicks.length === 0) {
    return <p className="text-foreground-muted">No picks yet</p>
  }

  // Sort by most recent first
  const sortedPicks = [...draftPicks].sort((a, b) => {
    if (a.round !== b.round) return b.round - a.round
    return b.pick_number - a.pick_number
  })

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {sortedPicks.map((pick, index) => (
        <div
          key={pick.id}
          className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
            index === 0
              ? 'bg-gold-muted border-gold animate-fade-in'
              : 'bg-elevated border-border'
          }`}
        >
          {/* Movie Poster Thumbnail */}
          {pick.movies?.poster_url ? (
            <img
              src={pick.movies.poster_url}
              alt={pick.movies.title}
              className="w-10 h-15 object-cover rounded-lg border border-border flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-15 bg-surface rounded-lg border border-border flex items-center justify-center flex-shrink-0">
              <ClapperboardIcon className="w-5 h-5 text-foreground-muted" />
            </div>
          )}

          {/* Pick Info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">{pick.movies?.title}</p>
            <p className="text-sm text-foreground-muted truncate">{pick.teams?.name}</p>
          </div>

          {/* Round/Pick Badge */}
          <div className="flex-shrink-0 text-right">
            <span
              className={`inline-block px-2 py-1 rounded-lg text-xs font-medium ${
                index === 0 ? 'bg-gold text-background' : 'bg-surface text-foreground-muted'
              }`}
            >
              R{pick.round} P{pick.pick_number}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

