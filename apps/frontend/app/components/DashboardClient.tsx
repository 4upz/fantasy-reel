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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // One read for the whole page. The league list and the trophy case are the
  // same rows counted two ways, so fetching them separately would put two
  // queries and two loading states on one screen - and `final_standings` rides
  // along on each row, so champions need no lookup of their own.
  useEffect(() => {
    let cancelled = false

    async function loadLeagues(): Promise<void> {
      setLoading(true)
      setLoadError(null)
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!session) throw new Error('Your session has expired. Sign in again to load your leagues.')
        if (cancelled) return
        setUserId(session.user.id)

        const { data, error } = await supabase
          .from('leagues')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        if (!cancelled) setLeagues((data ?? []) as League[])
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load your leagues. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadLeagues()
    return () => {
      cancelled = true
    }
  }, [supabase, retry])

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
        <h1 className="type-page text-foreground">
          Your leagues
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
          {loadError ? (
            <div className="alert alert-error" role="alert">
              <p>{loadError}</p>
              <button type="button" className="btn btn-secondary mt-3" onClick={() => setRetry((value) => value + 1)}>Try again</button>
            </div>
          ) : (
            <LeagueManager
              leagues={leagues}
              loading={loading}
              showCreateModal={showCreateModal}
              onModalClose={() => setShowCreateModal(false)}
              onCreateClick={() => setShowCreateModal(true)}
              onLeagueCreated={handleLeagueCreated}
            />
          )}
        </div>

        {/* Sidebar - Actions and Stats */}
        <div>
          <DashboardSidebar onCreateClick={() => setShowCreateModal(true)} titles={titles} />
        </div>
      </div>
    </div>
  )
}
