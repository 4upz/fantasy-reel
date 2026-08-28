'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import type { DashboardTeam, League, LeagueUpcomingRelease } from '@/types'
import type { Champion } from '@/utils/seasons'
import TeamHeader from '../components/TeamHeader'
import ChampionBanner from '../components/ChampionBanner'
import SeasonWelcomeCard from '../components/SeasonWelcomeCard'
import StartNextSeasonButton from '../components/StartNextSeasonButton'
import MovieGrid from '../components/MovieGrid'
import LeagueReleaseBoard from '../components/LeagueReleaseBoard'
import EditTeamModal from '../components/EditTeamModal'

interface Props {
  league: League
  userTeam: DashboardTeam | null
  totalTeams: number
  leagueUpcoming: LeagueUpcomingRelease[]
  todayIso: string
  isOwner: boolean
  /** Every team at rank 1 on a completed season; empty while it is running. */
  champions: Champion[]
  championPoints: number | null
  /** Display names carried into a rollover, for the confirm modal. */
  participantNames: string[]
  /** The season this one follows, if any. */
  previousSeason: { id: string; seasonYear: number } | null
}

export default function DashboardClient({
  league: initialLeague,
  userTeam,
  totalTeams,
  leagueUpcoming,
  todayIso,
  isOwner,
  champions,
  championPoints,
  participantNames,
  previousSeason,
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
      {/* The season's headline, when it has one. Only ever one of the two:
          a league is either finished or freshly rolled over, never both. */}
      {league.status === 'completed' && (
        <div className="mx-4 mb-[18px]">
          <ChampionBanner
            seasonYear={league.season_year}
            champions={champions}
            points={championPoints}
            action={
              isOwner ? (
                <StartNextSeasonButton
                  leagueId={league.id}
                  seasonYear={league.season_year}
                  participantNames={participantNames}
                />
              ) : undefined
            }
          />
        </div>
      )}

      {league.status === 'setup' && previousSeason && (
        <div className="mx-4 mb-[18px]">
          <SeasonWelcomeCard
            leagueId={league.id}
            seasonYear={league.season_year}
            teamName={userTeam.name}
            previousSeason={previousSeason}
          />
        </div>
      )}

      <TeamHeader
        team={userTeam}
        totalTeams={totalTeams}
        leagueName={league.name}
        onEditTeam={() => setShowEditTeamModal(true)}
      />
      <MovieGrid movies={userTeam.movies} leagueStatus={league.status} />
      <LeagueReleaseBoard releases={leagueUpcoming} todayIso={todayIso} />

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
