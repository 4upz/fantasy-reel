'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { League, DashboardTeam } from '@/types'
import TeamHeader from '../components/TeamHeader'
import MovieGrid from '../components/MovieGrid'
import EditTeamModal from '../components/EditTeamModal'
import { Heart } from 'lucide-react'
import Link from 'next/link'

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
  const [wishlistCount, setWishlistCount] = useState(0)

  const supabase = useMemo(() => createClient(), [])
  const channelIdRef = useRef(0)

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
        .eq('status', 'accepted')
        .neq('user_id', user.id)
        .eq('profiles.wishlist_public', true)

      if (!cancelled && data) {
        setWishlistCount(data.length)
      }
    }
    fetchWishlistCount()
    return () => { cancelled = true }
  }, [league.id, supabase])

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

      {wishlistCount > 0 && (
        <div className="card p-4 flex items-center gap-3">
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
