'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callEdgeFunction } from '@/utils/supabase/functions'

interface Props {
  token?: string
  userDisplayName?: string
}

interface JoinResponse {
  participant: {
    id: string
    league_id: string
  }
  team: {
    id: string
    name: string
  }
  league: {
    id: string
    name: string
  }
}

export default function JoinLeagueClient({ token, userDisplayName }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')

  const handleJoin = async () => {
    if (!token) {
      setError('Invalid invitation link')
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: joinError } = await callEdgeFunction<JoinResponse>('join-league', {
      body: {
        invitation_token: token,
        team_name: teamName.trim() || undefined,
      },
    })

    if (joinError) {
      setError(joinError)
      setLoading(false)
    } else if (data?.league) {
      router.push(`/league/${data.league.id}`)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <div className="text-6xl mb-4">🎬</div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-2">Invalid Invitation</h1>
          <p className="text-foreground-secondary mb-6">
            This invitation link is invalid or missing a token.
          </p>
          <Link
            href="/dashboard"
            className="btn btn-primary"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="card p-8 max-w-md w-full animate-fade-in">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-2xl font-bold font-display text-foreground">Join League</h1>
          <p className="text-foreground-secondary mt-2">You&apos;ve been invited to join a fantasy movie league!</p>
          {userDisplayName && <p className="text-sm text-foreground-muted mt-1">Joining as {userDisplayName}</p>}
        </div>

        <div className="mb-6">
          <label htmlFor="teamName" className="block text-sm font-medium text-foreground-secondary mb-1">
            Team Name <span className="text-foreground-muted">(optional)</span>
          </label>
          <input
            type="text"
            id="teamName"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="My Production Company"
            className="input"
          />
          <p className="text-xs text-foreground-muted mt-1">
            Leave blank to use a default name based on your username
          </p>
        </div>

        {error && (
          <div className="alert alert-error mb-4">
            <p className="font-medium">Unable to join</p>
            <p className="text-sm opacity-90">{error}</p>
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="btn btn-primary w-full py-3 text-lg"
        >
          {loading ? 'Joining...' : 'Join League'}
        </button>

        <p className="text-center text-sm text-foreground-muted mt-4">
          <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
            Cancel and go to dashboard
          </Link>
        </p>
      </div>
    </div>
  )
}
