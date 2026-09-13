import { createClient } from '@/utils/supabase/server'
import { getCachedLeague, getCachedUser } from '@/utils/supabase/cached'
import { redirect, notFound } from 'next/navigation'
import TradingClient from './TradingClient'
import type { League, Team, TeamWithOwner, ParticipantWithProfile } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TradingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: { user } }, { data: league, error: leagueError }] = await Promise.all([
    getCachedUser(),
    getCachedLeague(id),
  ])
  if (!user) {
    redirect('/login')
  }

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

  // One participant read supplies both the current team and trading partners.
  const { data: participants } = await supabase
    .from('league_participants')
    .select('*, teams (*), profiles (display_name)')
    .eq('league_id', id)
    .eq('status', 'active')

  const participant = participants?.find((p) => p.user_id === user.id)
  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as Team | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  // Build current team info with display name
  const currentTeam: TeamWithOwner = {
    id: team.id,
    name: team.name,
    avatar_url: team.avatar_url,
    display_name: participant.profiles?.display_name ?? null,
  }

  const otherTeams: TeamWithOwner[] = (participants ?? [])
    .filter((p): p is ParticipantWithProfile & { teams: Team } => (
      p.user_id !== user.id && p.teams !== null
    ))
    .map((p) => ({
      id: p.teams.id,
      name: p.teams.name,
      avatar_url: p.teams.avatar_url,
      display_name: p.profiles?.display_name ?? null,
    }))

  const isOwner = league.owner_id === user.id

  return (
    <TradingClient
      league={league as League}
      userId={user.id}
      team={team}
      currentTeam={currentTeam}
      otherTeams={otherTeams}
      isOwner={isOwner}
    />
  )
}
