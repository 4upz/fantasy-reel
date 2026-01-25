import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import TradingClient from './TradingClient'
import type { League, Team, ParticipantWithTeam } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TradingPage({ params }: PageProps) {
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

  // Trading only available for active leagues
  if (league.status !== 'active') {
    redirect(`/league/${id}`)
  }

  // Check if trading is enabled
  if (!league.trades_enabled) {
    redirect(`/league/${id}/dashboard`)
  }

  // Parallelize independent queries (async-parallel optimization)
  const [participantResult, otherParticipantsResult] = await Promise.all([
    supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single(),
    supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', id)
      .eq('status', 'active')
      .neq('user_id', user.id),
  ])

  const { data: participant } = participantResult
  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as Team | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  const { data: participants } = otherParticipantsResult

  const otherTeams = (participants || [])
    .filter((p): p is ParticipantWithTeam & { teams: Team } => p.teams !== null)
    .map((p) => ({
      id: p.teams.id,
      name: p.teams.name,
      avatar_url: p.teams.avatar_url,
    }))

  const isOwner = league.owner_id === user.id

  return (
    <TradingClient
      league={league as League}
      team={team}
      otherTeams={otherTeams}
      isOwner={isOwner}
    />
  )
}
