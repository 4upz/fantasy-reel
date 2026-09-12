'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { DraftState } from '@/hooks/useDraftState'
import { trackEvent } from '@/utils/analytics'
import { buildTeamInfoByUserId, buildTeamInfoByTeamId } from '@/utils/league'
import CounterpickPicker from './CounterpickPicker'
import DraftProgressRing from './DraftProgressRing'
import DraftTurnStatus from './DraftTurnStatus'
import { SpinnerIcon, ClockIcon, ArrowUpIcon } from './Icons'
import { cn } from './utils'
import type {
  League,
  ParticipantWithProfile,
  Counterpick,
  CounterpickWithDetails,
  CounterpickTurnInfo,
} from '@/types'

interface Props {
  league: League
  participants: ParticipantWithProfile[]
  counterpicks: CounterpickWithDetails[]
  currentUserId: string
  onCounterpickMade: (confirmedLeague?: League) => Promise<DraftState | null>
  updatesUnavailable?: boolean
}

export default function CounterpickRound({
  league,
  participants,
  counterpicks,
  currentUserId,
  onCounterpickMade,
  updatesUnavailable = false,
}: Props) {
  const [currentTurn, setCurrentTurn] = useState<CounterpickTurnInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  const totalParticipants = participants.length
  const totalCounterpicks = totalParticipants * league.draft_counterpick_slots
  const counterpicksMade = counterpicks.length

  // Fetch current turn info
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    async function fetchCurrentTurn() {
      setLoading(true)
      setFetchError(null)
      try {
        const { data, error: rpcError } = await createClient().rpc('get_next_counterpick_turn', {
          p_league_id: league.id,
        }).abortSignal(controller.signal)
        if (cancelled) return
        if (rpcError) throw rpcError
        setCurrentTurn(data?.[0] ?? null)
      } catch {
        if (cancelled) return
        setFetchError('Could not load the counterpick turn. Retry before making a pick.')
        setCurrentTurn(null)
      } finally {
        clearTimeout(timeout)
        if (!cancelled) setLoading(false)
      }
    }

    if (league.status === 'counterpicking') {
      fetchCurrentTurn()
    }
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [league.id, league.status, counterpicks.length, retry])

  // Get current user's team
  const currentUserParticipant = useMemo(() => {
    return participants.find((p) => p.user_id === currentUserId)
  }, [participants, currentUserId])

  const currentUserTeamId = currentUserParticipant?.teams?.id

  // Check if it's the current user's turn
  const isMyTurn = !updatesUnavailable && !loading && !fetchError && currentTurn?.user_id === currentUserId

  // Check if round is complete
  const isRoundComplete = league.status === 'counterpicking' && !currentTurn && !loading && !fetchError

  // Map of user_id to team info for display
  const teamInfoByUserId = useMemo(() => buildTeamInfoByUserId(participants), [participants])

  function getTeamName(userId: string): string {
    return teamInfoByUserId.get(userId)?.teamName ?? 'Unknown Team'
  }

  function getOwnerName(userId: string): string | null {
    return teamInfoByUserId.get(userId)?.ownerName ?? null
  }

  const pendingPick = useRef<{ movieId: string; expectedPick: number; requestId: string; teamId: string } | null>(null)
  const counterpickAction = useCallback(async (movieId: string): Promise<void> => {
    if (!pendingPick.current || pendingPick.current.movieId !== movieId) {
      if (!currentTurn || !currentUserTeamId || updatesUnavailable) throw new Error('Refresh the counterpick turn before picking.')
      pendingPick.current = {
        movieId, expectedPick: (currentTurn.round - 1) * totalParticipants + currentTurn.pick_number,
        requestId: crypto.randomUUID(), teamId: currentUserTeamId,
      }
    }
    const pending = pendingPick.current
    const { data, error: pickError } = await callEdgeFunction<{
      counterpick: Counterpick; round_complete: boolean; league: League; replayed: boolean
    }>('make-counterpick', {
      timeoutMs: 30_000,
      body: { league_id: league.id, movie_id: movieId, expected_pick: pending.expectedPick, request_id: pending.requestId },
    })
    const snapshot = await onCounterpickMade(data?.league)
    const confirmed = snapshot?.counterpicks.some(pick => pick.movie_id === movieId &&
      pick.counterpicker_team_id === pending.teamId && pick.pick_order === pending.expectedPick)
    if (!confirmed && snapshot?.counterpicks.some(pick => pick.pick_order === pending.expectedPick)) pendingPick.current = null
    if (pickError && !confirmed) throw new Error(`${pickError} Your selection is kept. Retry or check the previous pick.`)
    if (!data && !confirmed) throw new Error('The counterpick could not be confirmed. Check the previous pick before choosing again.')
    pendingPick.current = null
    if (!data?.replayed) trackEvent('counterpick_made', { league_id: league.id })
  }, [currentTurn, currentUserTeamId, totalParticipants, updatesUnavailable, league.id, onCounterpickMade])
  const { execute: handleCounterpick, isLoading: picking, error } = useAsyncAction(counterpickAction)

  // Render different states based on league status
  if (league.status !== 'counterpicking') {
    return (
      <div className="card p-6">
        <h2 className="type-section text-foreground mb-4">Counterpick round</h2>
        <div className="text-center py-8">
          <div className="flex justify-center mb-4">
            <Target className="w-16 h-16 text-foreground-muted" />
          </div>
          <p className="text-foreground-secondary mb-2">The counterpick round hasn&apos;t started yet.</p>
          <p className="type-body-sm text-foreground-secondary">
            Counterpicking begins after the draft is complete.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <DraftTurnStatus label={loading ? 'Updating counterpick turn…' : currentTurn
          ? isMyTurn ? 'Your turn to counterpick' : `${getTeamName(currentTurn.user_id)} is counterpicking`
          : 'Counterpick round needs attention'}
        detail={currentTurn ? `Round ${currentTurn.round}, pick ${currentTurn.pick_number}` : 'Review the round status above.'}
        isMyTurn={isMyTurn} unavailable={updatesUnavailable || Boolean(fetchError)} />
      {loading && <div className="card p-4 flex items-center gap-3" role="status">
        <SpinnerIcon className="w-5 h-5 text-gold animate-spin" /> Updating counterpick turn…
      </div>}
      {fetchError && <div className="card p-6" role="alert">
        <p className="text-error mb-3">{fetchError}</p>
        <button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry turn information</button>
      </div>}
      {isRoundComplete && <div className="card p-6">
        <p className="type-card text-foreground">No remaining turn was returned.</p>
        <p className="type-body-sm text-foreground-secondary mt-2">The league is still counterpicking. Refresh its state or ask the owner to finish the round.</p>
        <button className="btn btn-secondary mt-3" onClick={() => { void onCounterpickMade(); setRetry(value => value + 1) }}>Refresh draft</button>
      </div>}
      {/* Counterpick Header Card */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
          {/* Left: Title and Status */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="type-section text-foreground">Counterpick round</h2>
            </div>

            {/* Current Turn Indicator */}
            {currentTurn && (
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
                      isMyTurn ? 'bg-success text-foreground-inverse' : 'bg-gold text-foreground-inverse'
                    }`}
                  >
                    {isMyTurn ? (
                      <ArrowUpIcon className="w-6 h-6" />
                    ) : (
                      <ClockIcon className="w-6 h-6" />
                    )}
                  </div>
                  <div>
                    <p className="type-body-sm text-foreground-secondary">
                      Round {currentTurn.round}, Pick {currentTurn.pick_number}
                    </p>
                    <p
                      className={`type-card ${
                        isMyTurn ? 'text-success' : 'text-foreground'
                      }`}
                    >
                      {isMyTurn ? "It's your turn!" : `${getTeamName(currentTurn.user_id)}'s pick`}
                    </p>
                    {!isMyTurn && getOwnerName(currentTurn.user_id) && (
                      <p className="type-meta text-foreground-secondary">
                        {getOwnerName(currentTurn.user_id)}
                      </p>
                    )}
                    {isMyTurn && (
                      <p className="type-body-sm text-foreground-secondary mt-1">
                        {currentTurn.counterpicks_remaining} counterpick{currentTurn.counterpicks_remaining !== 1 ? 's' : ''} remaining
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Progress Ring */}
          <div className="flex-shrink-0 self-center sm:self-start">
            <DraftProgressRing current={counterpicksMade} total={totalCounterpicks} size="lg" />
          </div>
        </div>

        {/* Counterpick Queue */}
        {currentTurn && (
          <div className="mt-4 pt-4 sm:mt-6 sm:pt-6 border-t border-border">
            <CounterpickQueue
              participants={participants}
              currentPickIndex={counterpicksMade}
              currentUserId={currentUserId}
              rounds={league.draft_counterpick_slots}
            />
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" role="alert">
        <p>{error}</p>
        {pendingPick.current && <button className="btn btn-secondary mt-3" disabled={picking} onClick={() => {
          if (pendingPick.current) void handleCounterpick(pendingPick.current.movieId).catch(() => {})
        }}>Check previous counterpick</button>}
      </div>}

      {/* Counterpick Picker - Only show when user is a participant */}
      {currentUserTeamId && (
        <div className="card p-6">
          <CounterpickPicker
            leagueId={league.id}
            teamId={currentUserTeamId}
            isMyTurn={isMyTurn}
            isPicking={picking}
            onPick={handleCounterpick}
            revision={counterpicks.length}
            draftRound
          />
        </div>
      )}

      {/* Counterpick History */}
      {counterpicks.length > 0 && (
        <div className="card p-6">
          <h3 className="type-panel text-foreground mb-4">
            Counterpick history
          </h3>
          <CounterpickHistory counterpicks={counterpicks} participants={participants} />
        </div>
      )}
    </div>
  )
}

interface CounterpickHistoryProps {
  counterpicks: CounterpickWithDetails[]
  participants: ParticipantWithProfile[]
}

function CounterpickHistory({ counterpicks, participants }: CounterpickHistoryProps) {
  // Map team_id to team info
  const teamInfoById = useMemo(() => buildTeamInfoByTeamId(participants), [participants])

  if (counterpicks.length === 0) {
    return <p className="text-foreground-secondary">No counterpicks yet</p>
  }

  // Sort by most recent first
  const sortedPicks = [...counterpicks].sort((a, b) => {
    return b.pick_order - a.pick_order
  })

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {sortedPicks.map((pick, index) => (
        <div
          key={pick.id}
          className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
            index === 0
              ? 'bg-crimson/10 border-crimson/30 animate-fade-in'
              : 'bg-elevated border-border'
          }`}
        >
          {/* Target icon */}
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            index === 0 ? 'bg-crimson/20' : 'bg-surface'
          }`}>
            <Target className={`w-5 h-5 ${index === 0 ? 'text-crimson' : 'text-foreground-muted'}`} />
          </div>

          {/* Pick Info */}
          <div className="flex-1 min-w-0">
            <p className="type-label text-foreground">
              {teamInfoById.get(pick.counterpicker_team_id)?.teamName ?? 'Unknown'} counterpicked{' '}
              <span className="text-foreground-secondary">
                {teamInfoById.get(pick.target_team_id)?.teamName ?? 'Unknown'}
              </span>
            </p>
            <p className="type-meta text-foreground-secondary">
              {teamInfoById.get(pick.counterpicker_team_id)?.ownerName ?? ''}
              {teamInfoById.get(pick.counterpicker_team_id)?.ownerName && ' → '}
              {teamInfoById.get(pick.target_team_id)?.ownerName ?? ''}
            </p>
            {pick.movies && (
              <p className="type-meta text-foreground-secondary truncate mt-0.5">
                {pick.movies.title}
              </p>
            )}
          </div>

          {/* Pick order badge */}
          <div className="flex-shrink-0">
            <span
              className={`type-meta inline-block px-2 py-1 rounded-lg ${
                index === 0 ? 'bg-crimson text-white' : 'bg-surface text-foreground-secondary'
              }`}
            >
              #{pick.pick_order}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function getCounterpickQueueItemStyles(isFirst: boolean, isCurrentUser: boolean): string {
  if (isFirst && isCurrentUser) {
    return 'bg-success-bg border-success'
  }
  if (isFirst) {
    return 'bg-crimson/10 border-crimson/30'
  }
  return 'bg-elevated border-border'
}

interface CounterpickQueueProps {
  participants: ParticipantWithProfile[]
  currentPickIndex: number
  currentUserId: string
  rounds: number
}

function CounterpickQueue({
  participants,
  currentPickIndex,
  currentUserId,
  rounds,
}: CounterpickQueueProps) {
  const totalParticipants = participants.length
  const totalPicks = totalParticipants * rounds

  // Calculate upcoming picks (reverse snake order for counterpicks)
  const upcomingPicks = useMemo(() => {
    const picks: Array<{ participant: ParticipantWithProfile; round: number; isCurrentUser: boolean }> = []
    const showCount = Math.min(6, totalPicks - currentPickIndex)

    for (let i = 0; i < showCount; i++) {
      const pickIndex = currentPickIndex + i
      const round = Math.floor(pickIndex / totalParticipants) + 1
      const pickInRound = pickIndex % totalParticipants

      // Reverse snake: start from highest draft_order and alternate
      let draftOrder: number
      if (round % 2 === 1) {
        // Odd rounds: descending order (highest first)
        draftOrder = totalParticipants - pickInRound
      } else {
        // Even rounds: ascending order (lowest first)
        draftOrder = pickInRound + 1
      }

      const participant = participants.find((p) => p.draft_order === draftOrder)
      if (participant) {
        picks.push({
          participant,
          round,
          isCurrentUser: participant.user_id === currentUserId,
        })
      }
    }

    return picks
  }, [participants, currentPickIndex, currentUserId, totalParticipants, totalPicks])

  if (upcomingPicks.length === 0) {
    return null
  }

  return (
    <div>
      <p className="type-body-sm text-foreground-secondary mb-3">Upcoming picks</p>
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {upcomingPicks.map((pick, index) => (
          <div
            key={`${pick.participant.id}-${pick.round}-${index}`}
            className={cn(
              'flex-shrink-0 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border transition-all',
              getCounterpickQueueItemStyles(index === 0, pick.isCurrentUser)
            )}
          >
            <p className={cn(
              'type-meta',
              index === 0 && pick.isCurrentUser ? 'text-success' : 'text-foreground-secondary'
            )}>
              {pick.isCurrentUser ? 'You' : pick.participant.teams?.name || 'Unknown'}
            </p>
            {!pick.isCurrentUser && pick.participant.profiles?.display_name && (
              <p className="type-meta text-foreground-secondary truncate max-w-20">
                {pick.participant.profiles.display_name}
              </p>
            )}
            <p className="type-meta text-foreground-secondary">R{pick.round}</p>
          </div>
        ))}
        {currentPickIndex + upcomingPicks.length < totalPicks && (
          <div className="flex-shrink-0 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface border border-border flex items-center">
            <p className="type-meta text-foreground-secondary">
              +{totalPicks - currentPickIndex - upcomingPicks.length} more
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
