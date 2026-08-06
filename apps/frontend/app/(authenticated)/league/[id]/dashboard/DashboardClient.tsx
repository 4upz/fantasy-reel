'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Heart } from 'lucide-react'
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
}: Props): React.ReactElement {
  const [league, setLeague] = useState(initialLeague)
  const [showEditTeamModal, setShowEditTeamModal] = useState(false)
  const [wishlistCount, setWishlistCount] = useState(0)

  const supabase = useMemo(() => createClient(), [])

  // Fetch count of league-mates with public wishlists
  useEffect(() => {
    let cancelled = false
    async function fetchWishlistCount() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data } = await supabase
        .from('league_participants')
        .select('user_id, profiles!inner(wishlist_public)')
        .eq('league_id', league.id)
        .eq('status', 'active')
        .neq('user_id', user.id)
        .eq('profiles.wishlist_public', true)

      if (!cancelled && data) {
        setWishlistCount(data.length)
      }
    }
    fetchWishlistCount()
    return () => { cancelled = true }
  }, [league.id, supabase])

  // Real-time subscription for league updates
  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-${league.id}`)
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

  // Cancels the layout's gutter so the Upcoming shelf can scroll to the screen
  // edge. Every section below owns its own 16px padding instead.
  return (
    <div className="-mx-4 pt-1.5 sm:-mx-6 lg:-mx-8">
      <TeamHeader
        team={userTeam}
        totalTeams={totalTeams}
        leagueName={league.name}
        onEditTeam={() => setShowEditTeamModal(true)}
      />
      <MovieGrid movies={userTeam.movies} leagueStatus={league.status} />

      {wishlistCount > 0 && (
        <div className="card mx-4 mt-[18px] flex items-center gap-3 p-4">
          <Heart className="w-5 h-5 text-crimson flex-shrink-0" />
          <p className="flex-1 text-sm text-foreground-secondary">
            {wishlistCount} league-mate{wishlistCount !== 1 ? 's have' : ' has'} shared their wishlist{wishlistCount !== 1 ? 's' : ''}
          </p>
          <Link href="/wishlist" className="text-sm text-gold hover:text-gold-hover transition-colors">
            View
          </Link>
        </div>
      )}

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
