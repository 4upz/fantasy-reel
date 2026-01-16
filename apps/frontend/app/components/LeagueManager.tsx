'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import type { League } from '@/types'
import CreateLeagueModal from './CreateLeagueModal'
import { EmptyTheater } from './illustrations'

interface Props {
  showCreateModal: boolean
  onModalClose: () => void
  onCreateClick: () => void
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  setup: 'badge-setup',
  drafting: 'badge-drafting',
  active: 'badge-active',
  completed: 'badge-completed',
}

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  active: 'Active',
  completed: 'Completed',
}

export default function LeagueManager({ showCreateModal, onModalClose, onCreateClick }: Props): React.ReactElement {
  const router = useRouter()
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(true)

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

  function handleLeagueClick(leagueId: string): void {
    router.push(`/league/${leagueId}`)
  }

  function handleLeagueCreated(league: League): void {
    setLeagues((prev) => [league, ...prev])
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Loading state - skeleton cards
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-5 animate-fade-in">
            <div className="flex justify-between items-start mb-3">
              <div className="skeleton h-6 w-3/4 rounded" />
              <div className="skeleton h-6 w-16 rounded-full" />
            </div>
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (leagues.length === 0) {
    return (
      <>
        <div className="text-center py-12">
          <div className="mb-6">
            <EmptyTheater size="md" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">No leagues yet</h3>
          <p className="text-foreground-muted mb-6 max-w-sm mx-auto">
            Create your first league and invite friends to start drafting movies together.
          </p>
          <button onClick={onCreateClick} className="btn btn-primary">
            Create Your First League
          </button>
        </div>

        <CreateLeagueModal
          isOpen={showCreateModal}
          onClose={onModalClose}
          onSuccess={handleLeagueCreated}
        />
      </>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <div
            key={league.id}
            onClick={() => handleLeagueClick(league.id)}
            className="card card-interactive p-5 cursor-pointer group"
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-semibold font-display text-foreground group-hover:text-gold transition-colors line-clamp-1">
                {league.name}
              </h3>
              <span className={`badge ${STATUS_BADGE_CLASS[league.status] || 'badge-completed'} shrink-0 ml-2`}>
                {STATUS_LABELS[league.status] || league.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <span>{league.max_participants} spots</span>
              <span className="w-1 h-1 rounded-full bg-foreground-muted" />
              <span>{league.invite_only ? 'Private' : 'Open'}</span>
              <span className="w-1 h-1 rounded-full bg-foreground-muted" />
              <span>{formatDate(league.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      <CreateLeagueModal
        isOpen={showCreateModal}
        onClose={onModalClose}
        onSuccess={handleLeagueCreated}
      />
    </>
  )
}
