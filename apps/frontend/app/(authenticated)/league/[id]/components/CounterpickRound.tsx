'use client'

import { useState, useEffect, useMemo } from 'react'
import { Target } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import CounterpickPicker from './CounterpickPicker'
import DraftProgressRing from './DraftProgressRing'
import { SpinnerIcon, ClockIcon, ArrowUpIcon, ClapperboardIcon, CheckIcon } from './Icons'
import type {
  League,
  ParticipantWithTeam,
  Counterpick,
  CounterpickTurnInfo,
  CounterpickOption,
} from '@/types'

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  counterpicks: Counterpick[]
  currentUserId: string
  onCounterpickMade: () => void
}

export default function CounterpickRound({
  league,
  participants,
  counterpicks,
  currentUserId,
  onCounterpickMade,
}: Props) {
  const [currentTurn, setCurrentTurn] = useState<CounterpickTurnInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalParticipants = participants.length
  const totalCounterpicks = totalParticipants * league.draft_counterpick_slots
  const counterpicksMade = counterpicks.length

  // Fetch current turn info
  useEffect(() => {
    async function fetchCurrentTurn() {
      setLoading(true)
      setError(null)

      const supabase = createClient()
      const { data, error: fetchError } = await supabase.rpc('get_next_counterpick_turn', {
        p_league_id: league.id,
      })

      if (fetchError) {
        console.error('Error fetching counterpick turn:', fetchError)
        setError('Failed to load turn information')
        setCurrentTurn(null)
      } else if (data && data.length > 0) {
        setCurrentTurn(data[0])
      } else {
        // No turn data means round is complete
        setCurrentTurn(null)
      }

      setLoading(false)
    }

    if (league.status === 'counterpicking') {
      fetchCurrentTurn()
    }
  }, [league.id, league.status, counterpicks.length])

  // Get current user's team
  const currentUserParticipant = useMemo(() => {
    return participants.find((p) => p.user_id === currentUserId)
  }, [participants, currentUserId])

  const currentUserTeamId = currentUserParticipant?.teams?.id

  // Check if it's the current user's turn
  const isMyTurn = currentTurn?.user_id === currentUserId

  // Check if round is complete
  const isRoundComplete = league.status === 'counterpicking' && !currentTurn && !loading

  // Map of user_id to team name for display
  const teamNamesByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const participant of participants) {
      map.set(participant.user_id, participant.teams?.name || 'Unknown Team')
    }
    return map
  }, [participants])

  function getTeamName(userId: string): string {
    return teamNamesByUserId.get(userId) || 'Unknown Team'
  }

  // Handle making a counterpick
  async function handleCounterpick(movieId: string, option: CounterpickOption): Promise<void> {
    setPicking(true)
    setError(null)

    const { data, error: pickError } = await callEdgeFunction<{
      counterpick: Counterpick
      round_complete: boolean
    }>('make-counterpick', {
      body: {
        league_id: league.id,
        movie_id: movieId,
      },
    })

    if (pickError) {
      setError(pickError)
    } else {
      onCounterpickMade()
      // If round complete, turn will be null on next fetch
      if (data?.round_complete) {
        setCurrentTurn(null)
      }
    }

    setPicking(false)
  }

  // Render different states based on league status
  if (league.status !== 'counterpicking') {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-semibold font-display text-foreground mb-4">Counterpick Round</h2>
        <div className="text-center py-8">
          <div className="flex justify-center mb-4">
            <Target className="w-16 h-16 text-foreground-muted" />
          </div>
          <p className="text-foreground-secondary mb-2">The counterpick round hasn&apos;t started yet.</p>
          <p className="text-sm text-foreground-muted">
            Counterpicking begins after the draft is complete.
          </p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-semibold font-display text-foreground mb-4">Counterpick Round</h2>
        <div className="text-center py-8">
          <SpinnerIcon className="w-8 h-8 text-gold mx-auto animate-spin" />
          <p className="text-foreground-secondary mt-3">Loading counterpick round...</p>
        </div>
      </div>
    )
  }

  // Round complete state
  if (isRoundComplete) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold font-display text-foreground">Counterpick Results</h2>
          <DraftProgressRing current={counterpicksMade} total={totalCounterpicks} size="sm" showLabel={false} />
        </div>
        <div className="p-4 rounded-xl bg-success-bg border-2 border-success mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-success rounded-full flex items-center justify-center">
              <CheckIcon className="w-5 h-5 text-background" />
            </div>
            <div>
              <p className="text-success font-semibold text-lg">Counterpick round complete!</p>
              <p className="text-success/80 text-sm">The league is now active.</p>
            </div>
          </div>
        </div>
        <CounterpickHistory counterpicks={counterpicks} participants={participants} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Counterpick Header Card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6">
          {/* Left: Title and Status */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-semibold font-display text-foreground">Counterpick Round</h2>
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
                      isMyTurn ? 'bg-success text-background' : 'bg-crimson text-white'
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
                      Round {currentTurn.round}, Pick {currentTurn.pick_number}
                    </p>
                    <p
                      className={`text-lg font-semibold ${
                        isMyTurn ? 'text-success' : 'text-foreground'
                      }`}
                    >
                      {isMyTurn ? "It's your turn!" : `${getTeamName(currentTurn.user_id)}'s pick`}
                    </p>
                    {isMyTurn && (
                      <p className="text-sm text-foreground-muted mt-1">
                        {currentTurn.counterpicks_remaining} counterpick{currentTurn.counterpicks_remaining !== 1 ? 's' : ''} remaining
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Progress Ring */}
          <div className="flex-shrink-0">
            <DraftProgressRing current={counterpicksMade} total={totalCounterpicks} size="lg" />
          </div>
        </div>

        {/* Counterpick Queue */}
        {currentTurn && (
          <div className="mt-6 pt-6 border-t border-border">
            <CounterpickQueue
              participants={participants}
              currentPickIndex={counterpicksMade}
              currentUserId={currentUserId}
              rounds={league.draft_counterpick_slots}
            />
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Counterpick Picker - Only show when user is a participant */}
      {currentUserTeamId && (
        <div className="card p-6">
          <CounterpickPicker
            leagueId={league.id}
            teamId={currentUserTeamId}
            isMyTurn={isMyTurn}
            isPicking={picking}
            onPick={handleCounterpick}
          />
        </div>
      )}

      {/* Counterpick History */}
      {counterpicks.length > 0 && (
        <div className="card p-6">
          <h3 className="text-lg font-display font-semibold text-foreground mb-4">
            Counterpick History
          </h3>
          <CounterpickHistory counterpicks={counterpicks} participants={participants} />
        </div>
      )}
    </div>
  )
}

interface CounterpickHistoryProps {
  counterpicks: Counterpick[]
  participants: ParticipantWithTeam[]
}

function CounterpickHistory({ counterpicks, participants }: CounterpickHistoryProps) {
  // Map team_id to team name
  const teamNamesById = useMemo(() => {
    const map = new Map<string, string>()
    for (const participant of participants) {
      if (participant.teams) {
        map.set(participant.teams.id, participant.teams.name)
      }
    }
    return map
  }, [participants])

  if (counterpicks.length === 0) {
    return <p className="text-foreground-muted">No counterpicks yet</p>
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
            <p className="font-medium text-foreground text-sm">
              {teamNamesById.get(pick.counterpicker_team_id) || 'Unknown'} counterpicked{' '}
              <span className="text-foreground-secondary">
                {teamNamesById.get(pick.target_team_id) || 'Unknown'}
              </span>
            </p>
            <p className="text-xs text-foreground-muted">
              Pick #{pick.pick_order}
            </p>
          </div>

          {/* Pick order badge */}
          <div className="flex-shrink-0">
            <span
              className={`inline-block px-2 py-1 rounded-lg text-xs font-medium ${
                index === 0 ? 'bg-crimson text-white' : 'bg-surface text-foreground-muted'
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

interface CounterpickQueueProps {
  participants: ParticipantWithTeam[]
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
    const picks: Array<{ participant: ParticipantWithTeam; round: number; isCurrentUser: boolean }> = []
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
  }, [participants, currentPickIndex, currentUserId, rounds, totalParticipants, totalPicks])

  if (upcomingPicks.length === 0) {
    return null
  }

  return (
    <div>
      <p className="text-sm text-foreground-muted mb-3">Upcoming Picks</p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {upcomingPicks.map((pick, index) => (
          <div
            key={`${pick.participant.id}-${pick.round}-${index}`}
            className={`flex-shrink-0 px-3 py-2 rounded-lg border transition-all ${
              index === 0
                ? pick.isCurrentUser
                  ? 'bg-success-bg border-success'
                  : 'bg-crimson/10 border-crimson/30'
                : 'bg-elevated border-border'
            }`}
          >
            <p className={`text-xs font-medium ${
              index === 0 && pick.isCurrentUser ? 'text-success' : 'text-foreground-secondary'
            }`}>
              {pick.isCurrentUser ? 'You' : pick.participant.teams?.name || 'Unknown'}
            </p>
            <p className="text-xs text-foreground-muted">R{pick.round}</p>
          </div>
        ))}
        {currentPickIndex + upcomingPicks.length < totalPicks && (
          <div className="flex-shrink-0 px-3 py-2 rounded-lg bg-surface border border-border flex items-center">
            <p className="text-xs text-foreground-muted">
              +{totalPicks - currentPickIndex - upcomingPicks.length} more
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
