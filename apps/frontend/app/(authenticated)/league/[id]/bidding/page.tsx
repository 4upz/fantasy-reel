import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BiddingClient from './BiddingClient'
import type { League } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

/** A roster row (draft pick or pickup) with its movie's tmdb_id embedded. */
interface RosterRow {
  team_id: string
  movies: { tmdb_id: number } | null
}

function toTmdbIds(rows: RosterRow[] | null): number[] {
  return (rows || [])
    .map((row) => row.movies?.tmdb_id)
    .filter((tmdbId): tmdbId is number => typeof tmdbId === 'number')
}

export default async function BiddingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Bidding only available for active leagues
  if (league.status !== 'active') {
    redirect(`/league/${id}`)
  }

  // Parallelize independent queries (async-parallel optimization)
  // A movie is owned if it sits on a roster either from the draft (draft_picks)
  // or from a won bid (pickups) -- the same union is_movie_eligible_for_pickup()
  // checks server-side. Dropped rows release the movie back into the pool, so
  // they're excluded here too.
  const [participantResult, draftPicksResult, pickupsResult] = await Promise.all([
    supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single(),
    supabase
      .from('draft_picks')
      .select(`team_id, movies (tmdb_id)`)
      .eq('league_id', id)
      .is('dropped_at', null),
    supabase
      .from('pickups')
      .select(`team_id, movies (tmdb_id)`)
      .eq('league_id', id)
      .is('dropped_at', null),
  ])

  const { data: participant } = participantResult
  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as { id: string } | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  const draftPicks = draftPicksResult.data as RosterRow[] | null
  const pickups = pickupsResult.data as RosterRow[] | null

  const ownedTmdbIds = [...new Set([...toTmdbIds(draftPicks), ...toTmdbIds(pickups)])]
  const usedPickupSlots = (pickups || []).filter((p) => p.team_id === team.id).length

  return (
    <BiddingClient
      league={league as League}
      teamId={team.id}
      ownedTmdbIds={ownedTmdbIds}
      usedPickupSlots={usedPickupSlots}
      biddingCounterpickSlots={league.bidding_counterpick_slots ?? 0}
    />
  )
}
