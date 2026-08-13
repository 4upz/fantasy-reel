import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BiddingShell from './BiddingShell'
import type { League, ParticipantWithProfile, Team, TeamWithOwner } from '@/types'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

/** A roster row (draft pick or pickup) with its movie's tmdb_id embedded. */
interface RosterRow {
  team_id: string
  movies: { tmdb_id: number } | null
}

function toTmdbIds(rows: RosterRow[] | null): number[] {
  return (rows ?? [])
    .map((row) => row.movies?.tmdb_id)
    .filter((tmdbId): tmdbId is number => typeof tmdbId === 'number')
}

/**
 * Loads everything both bidding tabs need, once. Living in the layout keeps the
 * shell mounted across tab navigation, so switching to History and back doesn't
 * refetch bids or flash empty sections.
 */
export default async function BiddingLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

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

  // A movie is owned if it sits on a roster either from the draft (draft_picks)
  // or from a won bid (pickups) -- the same union is_movie_eligible_for_pickup()
  // checks server-side. Dropped rows release the movie back into the pool, so
  // they're excluded here too.
  //
  // The new-bid cutoff and the deadline it hangs off both come from the
  // database rather than being recomputed here, so the client can never drift
  // from get_next_processing_deadline()'s idea of when the week turns over.
  const [
    participantsResult,
    draftPicksResult,
    pickupsResult,
    cutoffResult,
    deadlineResult,
  ] = await Promise.all([
    supabase
      .from('league_participants')
      .select(`*, teams (*), profiles (*)`)
      .eq('league_id', id)
      .eq('status', 'active'),
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
    supabase.rpc('get_new_bid_cutoff', { p_league_id: id }),
    supabase.rpc('get_next_processing_deadline'),
  ])

  const participants = (participantsResult.data ?? []) as ParticipantWithProfile[]

  const participant = participants.find((p) => p.user_id === user.id)
  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as Team | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  // Every team in the league, so results can name whoever placed a bid.
  const teams: TeamWithOwner[] = participants
    .filter((p): p is ParticipantWithProfile & { teams: Team } => p.teams !== null)
    .map((p) => ({
      id: p.teams.id,
      name: p.teams.name,
      avatar_url: p.teams.avatar_url,
      display_name: p.profiles?.display_name ?? null,
    }))

  const draftPicks = draftPicksResult.data as RosterRow[] | null
  const pickups = pickupsResult.data as RosterRow[] | null

  const ownedTmdbIds = [...new Set([...toTmdbIds(draftPicks), ...toTmdbIds(pickups)])]
  const usedPickupSlots = (pickups ?? []).filter((p) => p.team_id === team.id).length

  return (
    <BiddingShell
      league={league as League}
      teamId={team.id}
      teams={teams}
      ownedTmdbIds={ownedTmdbIds}
      usedPickupSlots={usedPickupSlots}
      biddingCounterpickSlots={league.bidding_counterpick_slots ?? 0}
      newBidCutoffAt={(cutoffResult.data as string | null) ?? null}
      processingDeadline={(deadlineResult.data as string | null) ?? null}
    >
      {children}
    </BiddingShell>
  )
}
