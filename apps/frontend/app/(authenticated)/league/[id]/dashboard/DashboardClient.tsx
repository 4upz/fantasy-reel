'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { League, DashboardTeam } from '@/types'
import TeamHeader from '../components/TeamHeader'
import MovieGrid from '../components/MovieGrid'
import EditTeamModal from '../components/EditTeamModal'

interface Props {
  league: League
  userTeam: DashboardTeam | null
  totalTeams: number
}

export default function DashboardClient({
  league: initialLeague,
  userTeam,
  totalTeams,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [showEditTeamModal, setShowEditTeamModal] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const channelIdRef = useRef(0)

  // Real-time subscription for score updates
  useEffect(() => {
    channelIdRef.current++
    const channelId = channelIdRef.current

    const channel = supabase
      .channel(`dashboard-${league.id}-${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'team_scores',
        },
        () => {
          // TODO: Implement data refetch when scores update (e.g., router.refresh())
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'movies',
        },
        () => {
          // TODO: Implement data refetch when movie scores are calculated
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leagues',
          filter: `id=eq.${league.id}`,
        },
        (payload) => {
          setLeague(payload.new as League)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [league.id, supabase])

  if (!userTeam) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-display font-semibold text-foreground mb-2">
          Welcome to {league.name}
        </h2>
        <p className="text-foreground-muted">
          {league.status === 'setup'
            ? 'Waiting for the draft to begin...'
            : 'Your team will appear here once you join the draft.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <TeamHeader
        team={userTeam}
        totalTeams={totalTeams}
        onEditTeam={() => setShowEditTeamModal(true)}
      />
      <MovieGrid movies={userTeam.movies} leagueStatus={league.status} />

      {showEditTeamModal && (
        <EditTeamModal
          teamId={userTeam.id}
          leagueId={league.id}
          currentName={userTeam.name}
          currentAvatarUrl={userTeam.avatar_url}
          onClose={() => setShowEditTeamModal(false)}
        />
      )}
    </div>
  )
}
