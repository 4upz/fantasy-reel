'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clapperboard, Link2 } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import { trackEvent } from '@/utils/analytics'

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

// Valid join code format: uppercase alphanumeric excluding ambiguous characters.
// New codes are 8 characters; leagues may still hold 6-character codes from before.
const JOIN_CODE_REGEX = /^(?:[A-HJ-KM-NP-Z2-9]{6}|[A-HJ-KM-NP-Z2-9]{8})$/i

const INVALID_CODE_MESSAGE =
  'Invalid code format. Codes are 6 or 8 characters, letters and numbers, without I, L, O, 0 or 1.'

export default function JoinLeagueClient({ token, code, userDisplayName }: Props) {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [manualCode, setManualCode] = useState(code?.toUpperCase() || '')
  const [joinError, setJoinError] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)

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
        trackEvent('league_joined', { league_id: data.league.id })
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
      codeInputRef.current?.focus()
      return
    }

    if (isManualEntry && !JOIN_CODE_REGEX.test(manualCode.trim())) {
      setJoinError(INVALID_CODE_MESSAGE)
      codeInputRef.current?.focus()
      return
    }

    handleJoin()
  }

  // Format the code input. Only separators are dropped: silently discarding a
  // mistyped character (O for 0, say) would leave a screen-reader user with a
  // code that doesn't match what they typed, so validation reports it instead.
  const handleCodeChange = (value: string) => {
    setManualCode(value.toUpperCase().replace(/[\s-]/g, ''))
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
            <h1 className="type-page text-foreground">Join a league</h1>
            <p id="join-code-hint" className="text-foreground-secondary mt-2">
              Enter the code shared by your league commissioner
            </p>
            {userDisplayName && (
              <p className="type-body-sm text-foreground-secondary mt-1">Joining as {userDisplayName}</p>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            {/* Join code Input */}
            <div className="mb-6">
              <label
                htmlFor="joinCode"
                className="type-label block text-foreground-secondary mb-2"
              >
                Join code
              </label>
              <input
                ref={codeInputRef}
                type="text"
                id="joinCode"
                value={manualCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC123"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={joinError ? true : undefined}
                aria-describedby={joinError ? 'join-code-hint join-error' : 'join-code-hint'}
                className="input text-center font-mono text-2xl font-bold tracking-[0.3em] uppercase placeholder:text-foreground-muted/50 placeholder:tracking-[0.3em]"
              />
            </div>

            {/* Team name Input */}
            <div className="mb-6">
              <label
                htmlFor="teamName"
                className="type-label block text-foreground-secondary mb-1"
              >
                Team name <span className="text-foreground-secondary">(optional)</span>
              </label>
              <input
                type="text"
                id="teamName"
                data-testid="team-name-input"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="My Production Company"
                aria-describedby="team-name-hint"
                className="input"
              />
              <p id="team-name-hint" className="type-meta text-foreground-secondary mt-1">
                Leave blank to use a default name based on your username
              </p>
            </div>

            {joinError && (
              <div id="join-error" className="alert alert-error mb-4" role="alert" data-testid="form-error">
                <p className="font-medium">Unable to join</p>
                <p className="type-body-sm opacity-90">{joinError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary w-full py-3 text-lg"
              data-testid="join-league-button"
            >
              {isLoading ? 'Joining...' : 'Join league'}
            </button>

            <p className="type-body-sm text-center text-foreground-secondary mt-4">
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
          <h1 className="type-page text-foreground">Join league</h1>
          <p className="text-foreground-secondary mt-2">
            {hasToken
              ? "You've been invited to join a fantasy movie league!"
              : "You're about to join a fantasy movie league!"}
          </p>
          {userDisplayName && (
            <p className="type-body-sm text-foreground-secondary mt-1">Joining as {userDisplayName}</p>
          )}
        </div>

        {hasCode && (
          <div className="mb-6 text-center">
            <p className="type-meta text-foreground-secondary mb-1">Joining with code</p>
            {/* Spelled out for screen readers, which read "ABC123" as a word and a number */}
            <div aria-hidden="true" className="font-mono text-xl font-bold tracking-[0.3em] text-gold">
              {code?.toUpperCase()}
            </div>
            <span className="sr-only">{code?.toUpperCase().split('').join(' ')}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label
              htmlFor="teamNameToken"
              className="type-label block text-foreground-secondary mb-1"
            >
              Team name <span className="text-foreground-secondary">(optional)</span>
            </label>
            <input
              type="text"
              id="teamNameToken"
              data-testid="team-name-input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Production Company"
              aria-describedby="team-name-token-hint"
              className="input"
            />
            <p id="team-name-token-hint" className="type-meta text-foreground-secondary mt-1">
              Leave blank to use a default name based on your username
            </p>
          </div>

          {joinError && (
            <div id="join-error" className="alert alert-error mb-4" role="alert" data-testid="form-error">
              <p className="font-medium">Unable to join</p>
              <p className="type-body-sm opacity-90">{joinError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary w-full py-3 text-lg"
            data-testid="join-league-button"
          >
            {isLoading ? 'Joining...' : 'Join league'}
          </button>

          <p className="type-body-sm text-center text-foreground-secondary mt-4">
            <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
              Cancel and go to dashboard
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
