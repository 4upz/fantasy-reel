'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/utils/supabase/client'
import type { League } from '@/types'
import FeaturedLeagueCard from './FeaturedLeagueCard'
import LeagueListItem from './LeagueListItem'

// Dynamic import for code splitting (bundle-dynamic-imports optimization)
const CreateLeagueModal = dynamic(() => import('./CreateLeagueModal'))

// Preload modal on user intent to eliminate perceived latency
function preloadCreateLeagueModal(): void {
  void import('./CreateLeagueModal')
}

interface Props {
  showCreateModal: boolean
  onModalClose: () => void
  onCreateClick: () => void
  onLeaguesLoaded?: (count: number) => void
}

export default function LeagueManager({
  showCreateModal,
  onModalClose,
  onCreateClick,
  onLeaguesLoaded,
}: Props): React.ReactElement {
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
        onLeaguesLoaded?.(leagues?.length || 0)
      }
    } catch (error) {
      console.error('Unexpected error fetching leagues:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleLeagueCreated(league: League): void {
    setLeagues((prev) => {
      const newLeagues = [league, ...prev]
      onLeaguesLoaded?.(newLeagues.length)
      return newLeagues
    })
  }

  // Loading state - skeleton
  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {/* Featured card skeleton */}
        <div className="card-featured p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1">
              <div className="skeleton h-8 w-3/4 rounded mb-2" />
              <div className="skeleton h-4 w-1/3 rounded" />
            </div>
            <div className="skeleton h-6 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="skeleton h-12 rounded" />
            <div className="skeleton h-12 rounded" />
            <div className="skeleton h-12 rounded" />
          </div>
        </div>
      </div>
    )
  }

  // Empty state
  if (leagues.length === 0) {
    return (
      <>
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-surface mb-6">
            <svg className="w-12 h-12 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h3 className="font-display text-2xl text-foreground mb-3">Start your cinematic journey</h3>
          <p className="text-foreground-muted mb-8 max-w-md mx-auto">
            Create your first fantasy movie league and invite friends to compete. Draft upcoming releases and score points based on reviews.
          </p>
          <button
            onClick={onCreateClick}
            onMouseEnter={preloadCreateLeagueModal}
            onFocus={preloadCreateLeagueModal}
            className="btn btn-primary text-lg px-6 py-3"
          >
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
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

  const [featuredLeague, ...otherLeagues] = leagues

  return (
    <>
      <div className="space-y-8">
        {/* Featured league section */}
        <section>
          <h4 className="font-display font-semibold text-foreground-secondary text-sm uppercase tracking-wide mb-3">
            Current League
          </h4>
          <FeaturedLeagueCard league={featuredLeague} />
        </section>

        {/* Secondary leagues list */}
        {otherLeagues.length > 0 && (
          <section>
            <h4 className="font-display font-semibold text-foreground-secondary text-sm uppercase tracking-wide mb-3">
              Other Leagues
            </h4>
            <div className="card overflow-hidden">
              {otherLeagues.map((league) => (
                <LeagueListItem key={league.id} league={league} />
              ))}
            </div>
          </section>
        )}
      </div>

      <CreateLeagueModal
        isOpen={showCreateModal}
        onClose={onModalClose}
        onSuccess={handleLeagueCreated}
      />
    </>
  )
}
