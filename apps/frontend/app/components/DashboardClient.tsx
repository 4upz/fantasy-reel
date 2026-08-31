'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import LeagueManager from './LeagueManager'
import PendingInvitations from './PendingInvitations'
import DashboardSidebar from './DashboardSidebar'
import type { InvitationWithLeague, League } from '@/types'

interface Props {
  pendingInvitations: InvitationWithLeague[]
}

export default function DashboardClient({ pendingInvitations }: Props): React.ReactElement {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [leagues, setLeagues] = useState<League[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // One read for the whole page. The league list and the trophy case are the
  // same rows counted two ways, so fetching them separately would put two
  // queries and two loading states on one screen - and `final_standings` rides
  // along on each row, so champions need no lookup of their own.
  useEffect(() => {
    let cancelled = false

    async function loadLeagues(): Promise<void> {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session || cancelled) return

      setUserId(session.user.id)

      const { data, error } = await supabase
        .from('leagues')
        .select('*')
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (error) {
        console.error('Error fetching leagues:', error)
        setLoading(false)
        return
      }

      setLeagues((data ?? []) as League[])
      setLoading(false)
    }

    loadLeagues()
    return () => {
      cancelled = true
    }
  }, [supabase])

  const handleLeagueCreated = useCallback((league: League) => {
    setLeagues((prev) => [league, ...prev])
  }, [])

  /**
   * A title is a season whose final standings put this user's own team at the
   * top. Reading the frozen record means no lookup of the user's teams: the row
   * already carries the user id beside the winning team id.
   */
  const titles = useMemo(() => {
    if (!userId) return []
    return leagues
      .filter((league) =>
        (league.final_standings ?? []).some(
          (row) => row.user_id === userId && (league.winner_team_ids ?? []).includes(row.team_id)
        )
      )
      .map((league) => ({
        leagueId: league.id,
        seriesName: league.name,
        seasonYear: league.season_year,
      }))
      .sort((a, b) => b.seasonYear - a.seasonYear)
  }, [leagues, userId])

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-3xl sm:text-4xl font-bold font-display text-foreground">
          Your Leagues
        </h1>
        <p className="text-foreground-secondary mt-2 max-w-xl lg:max-w-none">
          Draft upcoming movies, compete with friends, and score points based on reviews.
        </p>
      </div>

      {/* Pending Invitations Banner - Full width at top */}
      {pendingInvitations.length > 0 && (
        <div className="mb-6">
          <PendingInvitations initialInvitations={pendingInvitations} />
        </div>
      )}

      {/* Main Content - Two-column asymmetric layout */}
      <div className="dashboard-grid">
        {/* Main column - Leagues */}
        <div>
          <LeagueManager
            leagues={leagues}
            loading={loading}
            showCreateModal={showCreateModal}
            onModalClose={() => setShowCreateModal(false)}
            onCreateClick={() => setShowCreateModal(true)}
            onLeagueCreated={handleLeagueCreated}
          />
        </div>

        {/* Sidebar - Actions and Stats */}
        <div>
          <DashboardSidebar onCreateClick={() => setShowCreateModal(true)} titles={titles} />
        </div>
      </div>
    </div>
  )
}
