'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'

interface League {
  id: string
  name: string
  owner_id: string
  invite_only: boolean
  status: string
  max_participants: number
  created_at: string
}

export default function LeagueManager() {
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    invite_only: false,
    max_participants: 8
  })

  const supabase = createClient()

  useEffect(() => {
    fetchLeagues()
  }, [])

  const fetchLeagues = async () => {
    try {
      setLoading(true)
      
      // Get the current user's session
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        console.error('No session found')
        return
      }

      // For now, let's use direct Supabase call instead of Edge Function
      const { data: leagues, error } = await supabase
        .from('leagues')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching leagues:', error)
      } else {
        setLeagues(leagues || [])
      }
    } catch (error) {
      console.error('Error fetching leagues:', error)
    } finally {
      setLoading(false)
    }
  }

  const createLeague = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('Please enter a league name')
      return
    }

    try {
      setCreating(true)
      
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        console.error('No user found')
        return
      }

      const { data: league, error } = await supabase
        .from('leagues')
        .insert({
          name: formData.name.trim(),
          owner_id: user.id,
          invite_only: formData.invite_only,
          max_participants: formData.max_participants,
          status: 'setup'
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating league:', error)
        alert('Failed to create league')
      } else {
        setLeagues([league, ...leagues])
        setFormData({ name: '', invite_only: false, max_participants: 8 })
        setShowCreateForm(false)
      }
    } catch (error) {
      console.error('Error creating league:', error)
      alert('Failed to create league')
    } finally {
      setCreating(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'setup': return 'bg-blue-100 text-blue-800'
      case 'drafting': return 'bg-yellow-100 text-yellow-800'
      case 'active': return 'bg-green-100 text-green-800'
      case 'completed': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              Your Leagues
            </h3>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded"
            >
              Create League
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={createLeague} className="mb-6 p-4 border rounded-lg bg-gray-50">
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    League Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Enter league name"
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="max_participants" className="block text-sm font-medium text-gray-700">
                    Max Participants
                  </label>
                  <input
                    type="number"
                    id="max_participants"
                    value={formData.max_participants}
                    onChange={(e) => setFormData({ ...formData, max_participants: parseInt(e.target.value) })}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
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
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="invite_only" className="ml-2 block text-sm text-gray-900">
                    Invite Only
                  </label>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded"
                  >
                    {creating ? 'Creating...' : 'Create League'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="mt-2 text-sm text-gray-600">Loading leagues...</p>
            </div>
          ) : leagues.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No leagues yet. Create your first league to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {leagues.map((league) => (
                <div
                  key={league.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="text-lg font-medium text-gray-900">{league.name}</h4>
                      <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                        <span>Max: {league.max_participants} participants</span>
                        <span>{league.invite_only ? 'Invite Only' : 'Open'}</span>
                        <span>Created: {new Date(league.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(league.status)}`}>
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