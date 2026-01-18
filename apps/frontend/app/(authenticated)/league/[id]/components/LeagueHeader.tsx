'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Settings } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import type { League } from '@/types'
import ConnectionStatusIndicator, { type RealtimeStatus } from './ConnectionStatusIndicator'

interface Props {
  league: League
  isOwner: boolean
  participantCount: number
  realtimeStatus: RealtimeStatus
  onInviteClick: () => void
}

export default function LeagueHeader({ league, isOwner, participantCount, realtimeStatus, onInviteClick }: Props) {
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStartDraft(): Promise<void> {
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
          <h1 className="text-2xl font-bold font-display text-foreground">{league.name}</h1>
          <div className="mt-3 flex items-center gap-4">
            <span className={`badge ${STATUS_BADGE_CLASS[league.status]}`}>
              {getStatusLabel(league.status)}
            </span>
            <ConnectionStatusIndicator status={realtimeStatus} />
            <span className="text-sm text-foreground-muted">
              {league.invite_only ? 'Invite Only' : 'Open'}
            </span>
            <span className="text-sm text-foreground-muted">
              {participantCount} / {league.max_participants} participants
            </span>
          </div>
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </div>

        {isOwner && (
          <div className="flex gap-3 items-center">
            {league.status === 'setup' && (
              <>
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
              </>
            )}
            <Link
              href={`/league/${league.id}/settings`}
              className="btn btn-ghost p-2"
              title="League Settings"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="mt-6 flex gap-1 border-b border-border">
        <span className="px-4 py-2 text-sm font-medium text-gold border-b-2 border-gold">
          Draft
        </span>
        {league.status !== 'setup' ? (
          <Link
            href={`/league/${league.id}/standings`}
            className="px-4 py-2 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors border-b-2 border-transparent"
          >
            Standings
          </Link>
        ) : (
          <span className="px-4 py-2 text-sm font-medium text-foreground-muted/50 border-b-2 border-transparent cursor-not-allowed">
            Standings
          </span>
        )}
      </div>
    </div>
  )
}
