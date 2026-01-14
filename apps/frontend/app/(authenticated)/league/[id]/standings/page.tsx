import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import StandingsClient from './StandingsClient'
import type {
  League,
  ParticipantWithTeamScore,
  DraftPickWithScores,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function StandingsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
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

  // Standings only available for active or completed leagues
  if (league.status !== 'active' && league.status !== 'completed') {
    redirect(`/league/${id}`)
  }

  // Check if user is a participant in this league
  const { data: userParticipant } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!userParticipant) {
    redirect('/dashboard')
  }

  // Fetch participants with teams and team_scores
  const { data: participants } = await supabase
    .from('league_participants')
    .select(
      `
      *,
      teams (
        *,
        team_scores (*)
      )
    `
    )
    .eq('league_id', id)
    .eq('status', 'active')
    .order('draft_order', { ascending: true })

  // Fetch profiles separately (no direct FK from league_participants)
  const userIds = (participants ?? []).map((p) => p.user_id)
  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('*').in('user_id', userIds)
    : { data: [] }

  // Build profile lookup map for O(1) access
  const profilesByUserId = new Map(
    (profiles ?? []).map((p) => [p.user_id, p])
  )

  // Merge profiles into participants
  const participantsWithProfiles = (participants ?? []).map((p) => ({
    ...p,
    profiles: profilesByUserId.get(p.user_id) ?? null,
  }))

  // Fetch draft picks with movies and reviews
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(
      `
      *,
      movies (
        *,
        reviews (*)
      )
    `
    )
    .eq('league_id', id)
    .order('round', { ascending: true })
    .order('pick_number', { ascending: true })

  return (
    <StandingsClient
      league={league as League}
      participants={participantsWithProfiles as ParticipantWithTeamScore[]}
      draftPicks={(draftPicks ?? []) as DraftPickWithScores[]}
      currentUserId={user.id}
    />
  )
}
