'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callEdgeFunction } from '@/utils/supabase/functions'

interface Props {
  token?: string
  userEmail?: string
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

export default function JoinLeagueClient({ token, userEmail }: Props) {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <div className="text-6xl mb-4">🎬</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Invitation</h1>
          <p className="text-gray-600 mb-6">
            This invitation link is invalid or missing a token.
          </p>
          <Link
            href="/dashboard"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded font-medium"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-lg shadow max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🎬</div>
          <h1 className="text-2xl font-bold text-gray-900">Join League</h1>
          <p className="text-gray-600 mt-2">You&apos;ve been invited to join a fantasy movie league!</p>
          {userEmail && <p className="text-sm text-gray-500 mt-1">Joining as {userEmail}</p>}
        </div>

        <div className="mb-6">
          <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 mb-1">
            Team Name <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            id="teamName"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="My Production Company"
            className="w-full p-3 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave blank to use a default name based on your email
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
            <p className="font-medium">Unable to join</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-lg"
        >
          {loading ? 'Joining...' : 'Join League'}
        </button>

        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            Cancel and go to dashboard
          </Link>
        </p>
      </div>
    </div>
  )
}
