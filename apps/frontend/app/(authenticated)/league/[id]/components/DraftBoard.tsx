'use client'

import { useMemo, useCallback, useRef } from 'react'
import MoviePoster from '@/app/components/MoviePoster'
import { Target } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { describeTurn, type DraftAnnouncer, type DraftState } from '@/hooks/useDraftState'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'
import { buildTeamInfoByUserId, buildTeamInfoByTeamId, type TeamDisplayInfo } from '@/utils/league'
import MoviePicker from './MoviePicker'
import DraftProgressRing from './DraftProgressRing'
import PickOrderQueue from './PickOrderQueue'
import DraftBoardHeader from './DraftBoardHeader'
import DraftTurnStatus from './DraftTurnStatus'
import CounterpickRound from './CounterpickRound'
import { ClapperboardIcon } from './Icons'
import type { League, ParticipantWithProfile, DraftPickWithDetails, NextPickInfo, CounterpickWithDetails } from '@/types'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  draftPicks: DraftPickWithDetails[]
  counterpicks: CounterpickWithDetails[]
  currentUserId: string
  onPickMade: (confirmedLeague?: League) => Promise<DraftState | null>
  onCounterpickMade?: (confirmedLeague?: League) => Promise<DraftState | null>
  /** Confirms the viewer's own picks to screen readers. */
  onAnnounce?: DraftAnnouncer
  updatesUnavailable?: boolean
}

export default function DraftBoard({
  league,
  participants,
  draftPicks,
  counterpicks,
  currentUserId,
  onPickMade,
  onCounterpickMade,
  onAnnounce,
  updatesUnavailable = false,
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
  const isDraftComplete = league.status === 'drafting' && totalPicks > 0 && picksMade >= totalPicks

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

  const pendingPick = useRef<{ tmdbId: number; expectedPick: number; requestId: string; teamId: string } | null>(null)
  const draftPickAction = useCallback(async (tmdbId: number): Promise<void> => {
    if (!pendingPick.current || pendingPick.current.tmdbId !== tmdbId) {
      if (!nextPick || updatesUnavailable) throw new Error('Refresh draft updates before making a pick.')
      pendingPick.current = { tmdbId, expectedPick: picksMade + 1, requestId: crypto.randomUUID(), teamId: nextPick.team_id }
    }
    const pending = pendingPick.current
    const { data, error: pickError } = await callEdgeFunction<{ pick: DraftPickWithDetails; league: League; replayed: boolean }>('draft-pick', {
      timeoutMs: 30_000,
      body: { league_id: league.id, tmdb_id: tmdbId, expected_pick: pending.expectedPick, request_id: pending.requestId },
    })
    const snapshot = await onPickMade(data?.league)
    const confirmed = snapshot?.draftPicks.some(pick =>
      pick.movies?.tmdb_id === tmdbId && pick.team_id === pending.teamId &&
      (pick.round - 1) * totalParticipants + pick.pick_number === pending.expectedPick)
    if (!confirmed && snapshot?.draftPicks.some(pick =>
      (pick.round - 1) * totalParticipants + pick.pick_number === pending.expectedPick)) pendingPick.current = null
    if (pickError && !confirmed) throw new Error(`${pickError} Your selection is kept. Retry or check the previous pick before choosing again.`)
    if (!data && !confirmed) throw new Error('The pick could not be confirmed. Check the previous pick before choosing again.')
    pendingPick.current = null
    if (!data?.replayed) trackEvent('draft_pick_made', { league_id: league.id, round: Math.ceil(pending.expectedPick / totalParticipants) })
    const title = snapshot?.draftPicks.find(pick => pick.movies?.tmdb_id === tmdbId)?.movies?.title
    const next = snapshot ? describeTurn(snapshot, currentUserId) : null
    onAnnounce?.([title ? `You drafted ${title}.` : 'Your pick is in.', next?.message].filter(Boolean).join(' '), 'polite', true)
  }, [league.id, nextPick, onPickMade, picksMade, totalParticipants, updatesUnavailable, currentUserId, onAnnounce])

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
        <h2 className="type-section text-foreground mb-4" tabIndex={-1} data-draft-heading>Draft board</h2>
        <div className="text-center py-8">
          <div className="flex justify-center mb-4">
            <ClapperboardIcon className="w-16 h-16 text-foreground-muted" />
          </div>
          <p className="text-foreground-secondary mb-2">The draft hasn&apos;t started yet.</p>
          <p className="type-body-sm text-foreground-secondary">
            Waiting for the league owner to start the draft.
          </p>
          <p className="type-body-sm text-foreground-secondary mt-2">
            {participants.length} of {league.max_participants} participants joined
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
        onCounterpickMade={onCounterpickMade || onPickMade}
        onAnnounce={onAnnounce}
        updatesUnavailable={updatesUnavailable}
      />
    )
  }

  if (league.status === 'active' || league.status === 'completed') {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="type-section text-foreground" tabIndex={-1} data-draft-heading>Draft results</h2>
          <DraftProgressRing current={picksMade} total={totalPicks} size="sm" showLabel={false} />
        </div>
        <p className="text-foreground-secondary mb-4">The draft is complete!</p>
        <PickHistory draftPicks={draftPicks} teamInfoById={teamInfoById} />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0" data-testid="draft-board">
      {nextPick && <DraftTurnStatus label={isMyTurn ? 'Your turn to draft' : `${getTeamName(nextPick.user_id)} is picking`}
        detail={`Round ${nextPick.round}, pick ${nextPick.pick_number}`} isMyTurn={isMyTurn} unavailable={updatesUnavailable} />}
      <DraftBoardHeader
        picksMade={picksMade}
        totalPicks={totalPicks}
        turn={nextPick ? {
          round: nextPick.round,
          pickNumber: nextPick.pick_number,
          teamName: getTeamName(nextPick.user_id),
          ownerName: getOwnerName(nextPick.user_id),
        } : null}
        isMyTurn={isMyTurn}
        isDraftComplete={isDraftComplete}
        queue={nextPick ? (
          <PickOrderQueue
            participants={participants}
            currentPickIndex={picksMade}
            currentUserId={currentUserId}
            rounds={league.draft_slots}
          />
        ) : null}
      />

      {error && <div className="alert alert-error" role="alert">
        <p>{error}</p>
        {pendingPick.current && <button className="btn btn-secondary mt-3" disabled={picking} onClick={() => {
          if (pendingPick.current) void handleDraftPick(pendingPick.current.tmdbId).catch(() => {})
        }}>Check previous pick</button>}
      </div>}

      {/* Movie Picker - Always visible for browsing, but only pickable on your turn */}
      <div className="card p-4 sm:p-6">
        <MoviePicker
          draftedTmdbIds={draftedTmdbIds}
          seasonYear={league.season_year}
          doublePointsOver90={league.double_points_over_90}
          isMyTurn={isMyTurn && !updatesUnavailable}
          picking={picking}
          unavailableReason={updatesUnavailable ? 'Draft updates are unavailable. Retry updates before picking.' : undefined}
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
    return <p className="text-foreground-secondary">No picks yet</p>
  }

  // Sort by most recent first
  const sortedPicks = [...draftPicks].sort((a, b) => {
    if (a.round !== b.round) return b.round - a.round
    return b.pick_number - a.pick_number
  })

  return (
    // A keyboard can only scroll this list if the scroller itself takes focus:
    // nothing inside it is interactive.
    <div className="max-h-80 overflow-y-auto" tabIndex={0} role="region" aria-label="Pick history, most recent first">
      <ol className="space-y-2" role="list">
        {sortedPicks.map((pick, index) => {
          const counterpickerInfo = pick.counterpicked_by_team_id
            ? teamInfoById?.get(pick.counterpicked_by_team_id)
            : null
          const counterpickerName = counterpickerInfo?.teamName || 'Unknown Team'
          const pickerInfo = pick.teams?.id ? teamInfoById?.get(pick.teams.id) : null

          return (
            <li
              key={pick.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                index === 0
                  ? 'bg-gold-muted border-gold animate-fade-in'
                  : 'bg-elevated border-border'
              }`}
            >
              {/* Movie Poster Thumbnail */}
              <div className="relative w-10 h-15 rounded-lg overflow-hidden border border-border flex-shrink-0 bg-surface">
                <MoviePoster
                  src={pick.movies?.poster_url}
                  alt=""
                  sizes="40px"
                  posterSize="w154"
                />
              </div>

              {/* Pick Info */}
              <div className="flex-1 min-w-0">
                <p className="type-row-title text-foreground truncate">
                  {index === 0 && <span className="sr-only">Latest pick: </span>}
                  {pick.movies?.title}
                </p>
                <p className="type-body-sm text-foreground-secondary truncate">{pick.teams?.name}</p>
                {pickerInfo?.ownerName && (
                  <p className="type-meta text-foreground-secondary truncate">{pickerInfo.ownerName}</p>
                )}
              </div>

              {/* Counterpick Indicator */}
              {pick.counterpicked_by_team_id && (
                <div
                  className="flex-shrink-0"
                  title={`Counterpicked by ${counterpickerName}`}
                >
                  <Target className="w-4 h-4 text-crimson-text" />
                  <span className="sr-only">Counterpicked by {counterpickerName}</span>
                </div>
              )}

              {/* Round/Pick Badge */}
              <div className="flex-shrink-0 text-right">
                <span
                  aria-hidden="true"
                  className={`type-meta inline-block px-2 py-1 rounded-lg ${
                    index === 0 ? 'bg-gold text-foreground-inverse' : 'bg-surface text-foreground-secondary'
                  }`}
                >
                  R{pick.round} P{pick.pick_number}
                </span>
                <span className="sr-only">Round {pick.round}, pick {pick.pick_number}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
