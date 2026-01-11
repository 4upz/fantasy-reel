'use client'

import Link from 'next/link'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useState } from 'react'
import type { League } from '@/types'

interface Props {
  league: League
  isOwner: boolean
  participantCount: number
  onInviteClick: () => void
}

export default function LeagueHeader({ league, isOwner, participantCount, onInviteClick }: Props) {
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const statusColors: Record<string, string> = {
    setup: 'bg-blue-100 text-blue-800',
    drafting: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
  }

  const handleStartDraft = async () => {
    if (participantCount < 2) {
      setError('Need at least 2 participants to start the draft')
      return
    }

    setStartingDraft(true)
    setError(null)

    const { error: startError } = await callEdgeFunction('start-draft', {
      body: { league_id: league.id },
    })

    if (startError) {
      // If the Edge Function doesn't exist yet, we could update directly
      // For now, just show the error
      setError(startError)
    }

    setStartingDraft(false)
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-start">
        <div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{league.name}</h1>
          <div className="mt-2 flex items-center space-x-4">
            <span
              className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[league.status]}`}
            >
              {league.status.charAt(0).toUpperCase() + league.status.slice(1)}
            </span>
            <span className="text-sm text-gray-500">
              {league.invite_only ? 'Invite Only' : 'Open'}
            </span>
            <span className="text-sm text-gray-500">
              {participantCount} / {league.max_participants} participants
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        {isOwner && league.status === 'setup' && (
          <div className="flex space-x-2">
            <button
              onClick={onInviteClick}
              className="bg-white border border-indigo-600 text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded"
            >
              Invite Players
            </button>
            <button
              onClick={handleStartDraft}
              disabled={startingDraft || participantCount < 2}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded"
            >
              {startingDraft ? 'Starting...' : 'Start Draft'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
