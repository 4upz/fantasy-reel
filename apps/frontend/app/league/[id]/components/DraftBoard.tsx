'use client'

import { useState, useMemo } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import MoviePicker from './MoviePicker'
import type { League, ParticipantWithTeam, DraftPickWithDetails, Movie, NextPickInfo } from '@/types'

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  availableMovies: Movie[]
  currentUserId: string
  onPickMade: () => void
}

const TOTAL_ROUNDS = 5

export default function DraftBoard({
  league,
  participants,
  draftPicks,
  availableMovies,
  currentUserId,
  onPickMade,
}: Props) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Calculate whose turn it is
  const nextPick = useMemo<NextPickInfo | null>(() => {
    const totalParticipants = participants.length
    if (totalParticipants === 0) return null

    const picksMade = draftPicks.length
    const totalPicks = totalParticipants * TOTAL_ROUNDS

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
  }, [participants, draftPicks])

  const isMyTurn = nextPick?.user_id === currentUserId
  const isDraftComplete = league.status === 'drafting' && !nextPick

  const handleDraftPick = async (movieId: string) => {
    setPicking(true)
    setError(null)

    const { error: pickError } = await callEdgeFunction('draft-pick', {
      body: { league_id: league.id, movie_id: movieId },
    })

    if (pickError) {
      setError(pickError)
    } else {
      onPickMade()
    }

    setPicking(false)
  }

  // Get team name for a user
  const getTeamName = (userId: string) => {
    const participant = participants.find((p) => p.user_id === userId)
    return participant?.teams?.name || 'Unknown Team'
  }

  // Render different views based on league status
  if (league.status === 'setup') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Draft Board</h2>
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-gray-600 mb-2">The draft hasn&apos;t started yet.</p>
          <p className="text-sm text-gray-400">
            Waiting for the league owner to start the draft.
          </p>
          <p className="text-sm text-gray-400 mt-2">
            {participants.length} / {league.max_participants} participants joined
          </p>
        </div>
      </div>
    )
  }

  if (league.status === 'active' || league.status === 'completed') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Draft Results</h2>
        <p className="text-gray-600 mb-4">The draft is complete!</p>
        <PickHistory draftPicks={draftPicks} />
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Draft Board</h2>

      {/* Current Turn Indicator */}
      {nextPick && (
        <div className={`mb-4 p-4 rounded-lg ${isMyTurn ? 'bg-green-100' : 'bg-gray-100'}`}>
          <p className="font-medium">
            Round {nextPick.round}, Pick {nextPick.pick_number}
          </p>
          <p className={isMyTurn ? 'text-green-700 font-bold' : 'text-gray-600'}>
            {isMyTurn ? "It's your turn to pick!" : `Waiting for ${getTeamName(nextPick.user_id)}`}
          </p>
        </div>
      )}

      {isDraftComplete && (
        <div className="mb-4 p-4 rounded-lg bg-blue-100">
          <p className="text-blue-700 font-medium">Draft complete! Finalizing results...</p>
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

      {/* Draft Pick History */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Pick History</h3>
        <PickHistory draftPicks={draftPicks} />
      </div>

      {/* Movie Picker (only show if it's my turn) */}
      {isMyTurn && (
        <MoviePicker movies={availableMovies} picking={picking} onPick={handleDraftPick} />
      )}
    </div>
  )
}

function PickHistory({ draftPicks }: { draftPicks: DraftPickWithDetails[] }) {
  if (draftPicks.length === 0) {
    return <p className="text-gray-500">No picks yet</p>
  }

  return (
    <div className="space-y-2 max-h-60 overflow-y-auto">
      {draftPicks.map((pick) => (
        <div key={pick.id} className="flex items-center p-2 bg-gray-50 rounded">
          <span className="text-sm text-gray-500 w-20">
            R{pick.round} P{pick.pick_number}
          </span>
          <span className="font-medium flex-1 truncate">{pick.teams?.name}</span>
          <span className="text-gray-700 truncate max-w-48">{pick.movies?.title}</span>
        </div>
      ))}
    </div>
  )
}
