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
  const [draftPicksResult, pickupsResult, budgetResult, dropCountResult, counterpicksResult] =
    await Promise.all([
      supabase
        .from('draft_picks')
        .select('*, movies(*)')
        .eq('team_id', team.id)
        .is('dropped_at', null)
        .order('pick_number', { ascending: true }),
      supabase
        .from('pickups')
        .select('*, movies(*)')
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
    ])

  const { data: draftPicks } = draftPicksResult
  const { data: pickups } = pickupsResult
  const { data: budget } = budgetResult
  const { data: dropCount } = dropCountResult
  const { data: counterpicks } = counterpicksResult

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
    />
  )
}
