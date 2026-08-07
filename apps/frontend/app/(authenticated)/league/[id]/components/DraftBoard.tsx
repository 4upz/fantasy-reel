'use client'

import { useMemo, useCallback } from 'react'
import Image from 'next/image'
import { Target } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'
import { buildTeamInfoByUserId, buildTeamInfoByTeamId, type TeamDisplayInfo } from '@/utils/league'
import MoviePicker from './MoviePicker'
import DraftProgressRing from './DraftProgressRing'
import PickOrderQueue from './PickOrderQueue'
import CounterpickRound from './CounterpickRound'
import { ClapperboardIcon, ArrowUpIcon, ClockIcon } from './Icons'
import type { League, ParticipantWithProfile, DraftPickWithDetails, NextPickInfo, TMDbSearchResult, CounterpickWithDetails } from '@/types'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
  currentUserId: string
  onPickMade: () => void | Promise<void>
  onCounterpickMade?: () => void | Promise<void>
}

export default function DraftBoard({
  league,
  participants,
  draftPicks,
  counterpicks,
  currentUserId,
  onPickMade,
  onCounterpickMade,
}: Props): React.ReactElement {
  const totalParticipants = participants.length
  const totalPicks = totalParticipants * league.draft_slots
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

  // Maps for looking up team info by user_id or team_id
  const teamInfoByUserId = useMemo(() => buildTeamInfoByUserId(participants), [participants])
  const teamInfoById = useMemo(() => buildTeamInfoByTeamId(participants), [participants])

  const draftPickAction = useCallback(
    async (tmdbId: number, movieData: TMDbSearchResult): Promise<void> => {
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
        throw new Error(pickError)
      }

      await onPickMade()
      trackEvent('draft_pick_made', { league_id: league.id, round: nextPick?.round ?? 0 })
    },
    [league.id, onPickMade, nextPick]
  )

  const { execute: handleDraftPick, isLoading: picking, error } = useAsyncAction(draftPickAction)

  function getTeamName(userId: string): string {
    return teamInfoByUserId.get(userId)?.teamName ?? 'Unknown Team'
  }

  function getOwnerName(userId: string): string | null {
    return teamInfoByUserId.get(userId)?.ownerName ?? null
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

  // Counterpicking phase - render CounterpickRound instead
  if (league.status === 'counterpicking') {
    return (
      <CounterpickRound
        league={league}
        participants={participants}
        counterpicks={counterpicks}
        currentUserId={currentUserId}
        onCounterpickMade={onCounterpickMade || (() => {})}
      />
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
        <PickHistory draftPicks={draftPicks} teamInfoById={teamInfoById} />
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="draft-board">
      {/* Draft Header Card */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
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
                    {!isMyTurn && getOwnerName(nextPick.user_id) && (
                      <p className="text-xs text-foreground-muted">
                        {getOwnerName(nextPick.user_id)}
                      </p>
                    )}
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
          <div className="flex-shrink-0 self-center sm:self-start">
            <DraftProgressRing current={picksMade} total={totalPicks} size="lg" />
          </div>
        </div>

        {/* Pick Order Queue */}
        {nextPick && (
          <div className="mt-4 pt-4 sm:mt-6 sm:pt-6 border-t border-border">
            <PickOrderQueue
              participants={participants}
              currentPickIndex={picksMade}
              currentUserId={currentUserId}
              rounds={league.draft_slots}
            />
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Movie Picker - Always visible for browsing, but only pickable on your turn */}
      <div className="card p-4 sm:p-6">
        <MoviePicker
          draftedTmdbIds={draftedTmdbIds}
          isMyTurn={isMyTurn}
          picking={picking}
          onPick={handleDraftPick}
        />
      </div>
    </div>
  )
}

export interface PickHistoryProps {
  draftPicks: DraftPickWithDetails[]
  teamInfoById?: Map<string, TeamDisplayInfo>
}

export function PickHistory({ draftPicks, teamInfoById }: PickHistoryProps): React.ReactElement {
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
      {sortedPicks.map((pick, index) => {
        const counterpickerInfo = pick.counterpicked_by_team_id
          ? teamInfoById?.get(pick.counterpicked_by_team_id)
          : null
        const counterpickerName = counterpickerInfo?.teamName || 'Unknown Team'
        const pickerInfo = pick.teams?.id ? teamInfoById?.get(pick.teams.id) : null

        return (
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
              <div className="relative w-10 h-15 rounded-lg overflow-hidden border border-border flex-shrink-0">
                <Image
                  src={pick.movies.poster_url}
                  alt={pick.movies.title}
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="w-10 h-15 bg-surface rounded-lg border border-border flex items-center justify-center flex-shrink-0">
                <ClapperboardIcon className="w-5 h-5 text-foreground-muted" />
              </div>
            )}

            {/* Pick Info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{pick.movies?.title}</p>
              <p className="text-sm text-foreground-muted truncate">{pick.teams?.name}</p>
              {pickerInfo?.ownerName && (
                <p className="text-xs text-foreground-muted truncate">{pickerInfo.ownerName}</p>
              )}
            </div>

            {/* Counterpick Indicator */}
            {pick.counterpicked_by_team_id && (
              <div
                className="flex-shrink-0"
                title={`Counterpicked by ${counterpickerName}`}
              >
                <Target className="w-4 h-4 text-crimson" />
              </div>
            )}

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
        )
      })}
    </div>
  )
}

