'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clapperboard, Link2 } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'

interface Props {
  token?: string
  code?: string
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

// Regex for valid join code format (6 chars, uppercase alphanumeric excluding ambiguous)
const JOIN_CODE_REGEX = /^[A-HJ-KM-NP-Z2-9]{6}$/i

export default function JoinLeagueClient({ token, code, userDisplayName }: Props) {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [manualCode, setManualCode] = useState(code?.toUpperCase() || '')
  const [joinError, setJoinError] = useState<string | null>(null)

  // Determine the mode based on what was provided
  const hasToken = !!token
  const hasCode = !!code
  const isManualEntry = !hasToken && !hasCode

  const joinAction = useCallback(
    async () => {
      const body: Record<string, string | undefined> = {
        team_name: teamName.trim() || undefined,
      }

      if (hasToken) {
        body.invitation_token = token
      } else if (manualCode) {
        body.join_code = manualCode.toUpperCase()
      }

      const { data, error } = await callEdgeFunction<JoinResponse>('join-league', {
        body,
      })

      if (error) {
        setJoinError(error)
        throw new Error(error)
      }

      if (data?.league) {
        router.push(`/league/${data.league.id}`)
      }

      return data
    },
    [token, hasToken, manualCode, teamName, router]
  )

  const { execute: handleJoin, isLoading } = useAsyncAction(joinAction)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setJoinError(null)

    if (isManualEntry && !manualCode.trim()) {
      setJoinError('Please enter a join code')
      return
    }

    if (isManualEntry && !JOIN_CODE_REGEX.test(manualCode.trim())) {
      setJoinError('Invalid code format. Codes are 6 characters (letters and numbers).')
      return
    }

    handleJoin()
  }

  // Format the code input (uppercase, remove invalid chars)
  const handleCodeChange = (value: string) => {
    // Convert to uppercase, remove spaces and invalid characters
    const cleaned = value
      .toUpperCase()
      .replace(/[^A-HJ-KM-NP-Z2-9]/g, '')
      .slice(0, 6)
    setManualCode(cleaned)
    setJoinError(null)
  }

  // Manual entry mode - show code input form
  if (isManualEntry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="card p-8 max-w-md w-full animate-fade-in">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <div className="p-3 rounded-full bg-gold/10">
                <Link2 className="w-10 h-10 text-gold" />
              </div>
            </div>
            <h1 className="text-2xl font-bold font-display text-foreground">Join a League</h1>
            <p className="text-foreground-secondary mt-2">
              Enter the 6-character code shared by your league commissioner
            </p>
            {userDisplayName && (
              <p className="text-sm text-foreground-muted mt-1">Joining as {userDisplayName}</p>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            {/* Join Code Input */}
            <div className="mb-6">
              <label
                htmlFor="joinCode"
                className="block text-sm font-medium text-foreground-secondary mb-2"
              >
                Join Code
              </label>
              <input
                type="text"
                id="joinCode"
                value={manualCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC123"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby={joinError ? 'join-error' : undefined}
                className="input text-center font-mono text-2xl font-bold tracking-[0.3em] uppercase placeholder:text-foreground-muted/50 placeholder:tracking-[0.3em]"
              />
            </div>

            {/* Team Name Input */}
            <div className="mb-6">
              <label
                htmlFor="teamName"
                className="block text-sm font-medium text-foreground-secondary mb-1"
              >
                Team Name <span className="text-foreground-muted">(optional)</span>
              </label>
              <input
                type="text"
                id="teamName"
                data-testid="team-name-input"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="My Production Company"
                className="input"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Leave blank to use a default name based on your username
              </p>
            </div>

            {joinError && (
              <div id="join-error" className="alert alert-error mb-4" role="alert">
                <p className="font-medium">Unable to join</p>
                <p className="text-sm opacity-90">{joinError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || manualCode.length !== 6}
              className="btn btn-primary w-full py-3 text-lg"
              data-testid="join-league-button"
            >
              {isLoading ? 'Joining...' : 'Join League'}
            </button>

            <p className="text-center text-sm text-foreground-muted mt-4">
              <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
                Cancel and go to dashboard
              </Link>
            </p>
          </form>
        </div>
      </div>
    )
  }

  // Token or code provided via URL - show join confirmation
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="card p-8 max-w-md w-full animate-fade-in">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Clapperboard className="w-12 h-12 text-gold" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground">Join League</h1>
          <p className="text-foreground-secondary mt-2">
            {hasToken
              ? "You've been invited to join a fantasy movie league!"
              : "You're about to join a fantasy movie league!"}
          </p>
          {userDisplayName && (
            <p className="text-sm text-foreground-muted mt-1">Joining as {userDisplayName}</p>
          )}
        </div>

        {hasCode && (
          <div className="mb-6 text-center">
            <p className="text-xs text-foreground-muted mb-1">Joining with code</p>
            <div className="font-mono text-xl font-bold tracking-[0.3em] text-gold">
              {code?.toUpperCase()}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="teamNameToken"
              className="block text-sm font-medium text-foreground-secondary mb-1"
            >
              Team Name <span className="text-foreground-muted">(optional)</span>
            </label>
            <input
              type="text"
              id="teamNameToken"
              data-testid="team-name-input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Production Company"
              className="input"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Leave blank to use a default name based on your username
            </p>
          </div>

          {joinError && (
            <div id="join-error" className="alert alert-error mb-4" role="alert">
              <p className="font-medium">Unable to join</p>
              <p className="text-sm opacity-90">{joinError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full py-3 text-lg"
            data-testid="join-league-button"
          >
            {isLoading ? 'Joining...' : 'Join League'}
          </button>

          <p className="text-center text-sm text-foreground-muted mt-4">
            <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
              Cancel and go to dashboard
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
