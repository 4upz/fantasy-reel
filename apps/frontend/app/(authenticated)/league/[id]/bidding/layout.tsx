import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BiddingShell from './BiddingShell'
import type { League, ParticipantWithProfile, Team, TeamHolding, TeamWithOwner } from '@/types'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

/** The `team_holdings` columns this layout needs: who holds what movie, and how. */
type HoldingRow = Pick<
  TeamHolding,
  'team_id' | 'source' | 'tmdb_id' | 'holding_id' | 'title'
  | 'release_date' | 'counterpicked_by_team_id' | 'poster_url'
>

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

  // A movie is owned if it sits on a roster, drafted or won at auction -- the
  // same union is_movie_eligible_for_pickup() checks server-side, which is what
  // team_holdings reads. Dropped rows release the movie back into the pool and
  // the view leaves them out.
  //
  // The new-bid cutoff and the deadline it hangs off both come from the
  // database rather than being recomputed here, so the client can never drift
  // from get_next_processing_deadline()'s idea of when the week turns over.
  const [
    participantsResult,
    holdingsResult,
    cutoffResult,
    deadlineResult,
  ] = await Promise.all([
    supabase
      .from('league_participants')
      .select(`*, teams (*), profiles (*)`)
      .eq('league_id', id)
      .eq('status', 'active'),
    supabase.from('team_holdings').select(
      `team_id, source, tmdb_id, holding_id, title, release_date, counterpicked_by_team_id, poster_url`
    ).eq('league_id', id),
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

  const holdings = (holdingsResult.data ?? []) as HoldingRow[]

  const ownedTmdbIds = [...new Set(holdings.map((holding) => holding.tmdb_id))]

  // Pooled roster: draft picks and pickups share total_slots, so dropping a
  // drafted movie frees room for a pickup. That is what makes a conditional
  // drop useful -- the movie a team most wants to swap out is usually one it
  // drafted badly.
  const myHoldings = holdings.filter((holding) => holding.team_id === team.id)
  const usedRosterSlots = myHoldings.length

  return (
    <BiddingShell
      league={league as League}
      teamId={team.id}
      teams={teams}
      ownedTmdbIds={ownedTmdbIds}
      usedRosterSlots={usedRosterSlots}
      myHoldings={myHoldings}
      biddingCounterpickSlots={league.bidding_counterpick_slots ?? 0}
      newBidCutoffAt={(cutoffResult.data as string | null) ?? null}
      processingDeadline={(deadlineResult.data as string | null) ?? null}
    >
      {children}
    </BiddingShell>
  )
}
