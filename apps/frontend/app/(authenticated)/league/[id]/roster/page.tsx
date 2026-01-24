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

  // Fetch draft picks (excluding dropped ones)
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select('*, movies(*)')
    .eq('team_id', team.id)
    .is('dropped_at', null)
    .order('pick_number', { ascending: true })

  // Fetch pickups
  const { data: pickups } = await supabase
    .from('pickups')
    .select('*, movies(*)')
    .eq('team_id', team.id)
    .is('dropped_at', null)
    .order('picked_up_at', { ascending: true })

  // Fetch team budget
  const { data: budget } = await supabase
    .from('team_budgets')
    .select('*')
    .eq('team_id', team.id)
    .single()

  // Fetch drop count
  const { data: dropCount } = await supabase
    .rpc('get_team_drop_count', { p_team_id: team.id })

  return (
    <RosterClient
      league={league}
      team={team}
      draftPicks={draftPicks || []}
      pickups={pickups || []}
      budget={budget}
      dropCount={dropCount ?? 0}
      userId={user.id}
    />
  )
}
