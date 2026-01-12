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

const statusBadgeClass: Record<string, string> = {
  setup: 'badge-setup',
  drafting: 'badge-drafting',
  active: 'badge-active',
  completed: 'badge-completed',
}

export default function LeagueHeader({ league, isOwner, participantCount, onInviteClick }: Props) {
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(startError)
    }

    setStartingDraft(false)
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-start">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-gold hover:text-gold-hover transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold font-display text-foreground mt-2">{league.name}</h1>
          <div className="mt-3 flex items-center gap-4">
            <span className={`badge ${statusBadgeClass[league.status] || 'badge-completed'}`}>
              {league.status.charAt(0).toUpperCase() + league.status.slice(1)}
            </span>
            <span className="text-sm text-foreground-muted">
              {league.invite_only ? 'Invite Only' : 'Open'}
            </span>
            <span className="text-sm text-foreground-muted">
              {participantCount} / {league.max_participants} participants
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </div>

        {isOwner && league.status === 'setup' && (
          <div className="flex gap-3">
            <button onClick={onInviteClick} className="btn btn-secondary">
              Invite Players
            </button>
            <button
              onClick={handleStartDraft}
              disabled={startingDraft || participantCount < 2}
              className="btn btn-primary"
            >
              {startingDraft ? 'Starting...' : 'Start Draft'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
