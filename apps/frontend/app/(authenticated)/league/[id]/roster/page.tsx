import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import RosterClient from './RosterClient'

interface RosterPageProps {
  params: Promise<{ id: string }>
}

export default async function RosterPage({ params }: RosterPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    redirect('/dashboard')
  }

  // Get user's participant and team
  const { data: participant } = await supabase
    .from('league_participants')
    .select('id, teams(id, name)')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!participant) {
    redirect(`/league/${id}`)
  }

  const team = participant.teams as unknown as { id: string; name: string }

  // Parallelize independent queries (async-parallel optimization)
  const [
    draftPicksResult,
    pickupsResult,
    budgetResult,
    dropCountResult,
    counterpicksResult,
    openCounterpickBidsResult,
  ] = await Promise.all([
    // The counterpicked_by join names the team holding a counterpick so a
    // locked movie can say who locked it. Both tables have two FKs to teams, so
    // the constraint name is required (PGRST201 otherwise).
    supabase
      .from('draft_picks')
      .select(
        '*, movies(*), counterpicked_by:teams!draft_picks_counterpicked_by_team_id_fkey(name)'
      )
      .eq('team_id', team.id)
      .is('dropped_at', null)
      .order('pick_number', { ascending: true }),
    supabase
      .from('pickups')
      .select('*, movies(*), counterpicked_by:teams!pickups_counterpicked_by_team_id_fkey(name)')
      .eq('team_id', team.id)
      .is('dropped_at', null)
      .order('picked_up_at', { ascending: true }),
    supabase.from('team_budgets').select('*').eq('team_id', team.id).single(),
    supabase.rpc('get_team_drop_count', { p_team_id: team.id }),
    supabase
      .from('counterpicks')
      .select('*, movies(*), target_team:teams!counterpicks_target_team_id_fkey(name)')
      .eq('counterpicker_team_id', team.id)
      .order('pick_order', { ascending: true }),
    // Open counterpick auctions block drops the same way an awarded
    // counterpick does (see drop-movie), so the roster needs them to explain
    // why a movie is locked instead of silently hiding the drop control.
    supabase
      .from('counterpick_bids')
      .select('movie_id')
      .eq('league_id', id)
      .in('status', ['active', 'outbid']),
  ])

  const { data: draftPicks } = draftPicksResult
  const { data: pickups } = pickupsResult
  const { data: budget } = budgetResult
  const { data: dropCount } = dropCountResult
  const { data: counterpicks } = counterpicksResult
  const { data: openCounterpickBids } = openCounterpickBidsResult

  const contestedMovieIds = [...new Set((openCounterpickBids ?? []).map((bid) => bid.movie_id))]

  return (
    <RosterClient
      league={league}
      team={team}
      draftPicks={draftPicks || []}
      pickups={pickups || []}
      budget={budget}
      dropCount={dropCount ?? 0}
      userId={user.id}
      counterpicks={counterpicks || []}
      contestedMovieIds={contestedMovieIds}
    />
  )
}
