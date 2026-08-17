import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { HOLDING_MOVIE_COLUMNS } from '@/utils/holdings'
import RosterClient from './RosterClient'
import type { RosterHolding } from './types'

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
    holdingsResult,
    budgetResult,
    dropCountResult,
    counterpicksResult,
    openCounterpickBidsResult,
  ] = await Promise.all([
    // One read for the whole roster: team_holdings unions draft picks and
    // pickups with dropped rows already excluded, and carries the counterpicking
    // team's name so a locked movie can say who locked it.
    //
    // Draft picks sort by pick order, pickups by when they were won. 'draft'
    // sorts before 'pickup', and the key that doesn't apply to a leg is null
    // there, so one ordering covers both.
    supabase
      .from('team_holdings')
      .select(
        `holding_id, source, round, pick_number, amount_paid, counterpicked_by_team_id, counterpicked_by_name, ${HOLDING_MOVIE_COLUMNS}`
      )
      .eq('team_id', team.id)
      .order('source', { ascending: true })
      .order('pick_number', { ascending: true })
      .order('acquired_at', { ascending: true }),
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

  const { data: holdings } = holdingsResult
  const { data: budget } = budgetResult
  const { data: dropCount } = dropCountResult
  const { data: counterpicks } = counterpicksResult
  const { data: openCounterpickBids } = openCounterpickBidsResult

  const contestedMovieIds = [...new Set((openCounterpickBids ?? []).map((bid) => bid.movie_id))]

  return (
    <RosterClient
      league={league}
      team={team}
      holdings={(holdings ?? []) as RosterHolding[]}
      budget={budget}
      dropCount={dropCount ?? 0}
      userId={user.id}
      counterpicks={counterpicks || []}
      contestedMovieIds={contestedMovieIds}
    />
  )
}
