'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'

interface CreateLeagueResponse {
  league: League
  participant: { id: string }
  team: { id: string; name: string }
}

const statusBadgeClass: Record<string, string> = {
  setup: 'badge-setup',
  drafting: 'badge-drafting',
  active: 'badge-active',
  completed: 'badge-completed',
}

export default function LeagueManager() {
  const router = useRouter()
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    invite_only: false,
    max_participants: 8,
    team_name: '',
  })

  const supabase = createClient()

  useEffect(() => {
    fetchLeagues()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchLeagues = async () => {
    try {
      setLoading(true)

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        console.error('Error getting session:', sessionError)
        return
      }

      // Use direct Supabase call (RLS handles filtering)
      const { data: leagues, error } = await supabase
        .from('leagues')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Supabase error fetching leagues:', error)
      } else {
        setLeagues(leagues || [])
      }
    } catch (error) {
      console.error('Unexpected error fetching leagues:', error)
    } finally {
      setLoading(false)
    }
  }

  const createLeague = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Please enter a league name')
      return
    }

    setCreating(true)
    setError(null)

    // Use Edge Function for league creation (creates league + participant + team atomically)
    const { data, error: createError } = await callEdgeFunction<CreateLeagueResponse>(
      'create-league',
      {
        body: {
          name: formData.name.trim(),
          invite_only: formData.invite_only,
          max_participants: formData.max_participants,
          team_name: formData.team_name.trim() || undefined,
        },
      }
    )

    if (createError) {
      setError(createError)
      setCreating(false)
      return
    }

    if (data?.league) {
      // Reset form and navigate to the new league
      setFormData({ name: '', invite_only: false, max_participants: 8, team_name: '' })
      setShowCreateForm(false)
      router.push(`/league/${data.league.id}`)
    }

    setCreating(false)
  }

  const handleLeagueClick = (leagueId: string) => {
    router.push(`/league/${leagueId}`)
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold font-display text-foreground">Your Leagues</h3>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="btn btn-primary"
            >
              Create League
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={createLeague} className="mb-6 p-5 rounded-lg bg-elevated border border-border">
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-1">
                    League Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input"
                    placeholder="Enter league name"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="team_name" className="block text-sm font-medium text-foreground-secondary mb-1">
                    Your Team Name <span className="text-foreground-muted">(optional)</span>
                  </label>
                  <input
                    type="text"
                    id="team_name"
                    value={formData.team_name}
                    onChange={(e) => setFormData({ ...formData, team_name: e.target.value })}
                    className="input"
                    placeholder="My Production Company"
                  />
                </div>

                <div>
                  <label
                    htmlFor="max_participants"
                    className="block text-sm font-medium text-foreground-secondary mb-1"
                  >
                    Max Participants
                  </label>
                  <input
                    type="number"
                    id="max_participants"
                    value={formData.max_participants}
                    onChange={(e) =>
                      setFormData({ ...formData, max_participants: parseInt(e.target.value) })
                    }
                    className="input"
                    min="2"
                    max="20"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="invite_only"
                    checked={formData.invite_only}
                    onChange={(e) => setFormData({ ...formData, invite_only: e.target.checked })}
                    className="h-4 w-4 rounded border-border bg-elevated text-gold focus:ring-gold focus:ring-offset-background"
                  />
                  <label htmlFor="invite_only" className="ml-2 block text-sm text-foreground">
                    Invite Only
                  </label>
                </div>

                {error && <p className="text-sm text-error">{error}</p>}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={creating}
                    className="btn btn-primary"
                  >
                    {creating ? 'Creating...' : 'Create League'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false)
                      setError(null)
                    }}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gold"></div>
              <p className="mt-3 text-sm text-foreground-secondary">Loading leagues...</p>
            </div>
          ) : leagues.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">🎬</div>
              <p className="text-foreground-muted">No leagues yet. Create your first league to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {leagues.map((league) => (
                <div
                  key={league.id}
                  onClick={() => handleLeagueClick(league.id)}
                  className="card card-interactive p-4 cursor-pointer"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="text-lg font-medium text-foreground">{league.name}</h4>
                      <div className="mt-2 flex items-center gap-4 text-sm text-foreground-muted">
                        <span>Max: {league.max_participants} participants</span>
                        <span>{league.invite_only ? 'Invite Only' : 'Open'}</span>
                        <span>Created: {new Date(league.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span className={`badge ${statusBadgeClass[league.status] || 'badge-completed'}`}>
                      {league.status.charAt(0).toUpperCase() + league.status.slice(1)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
