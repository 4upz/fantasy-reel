import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import StandingsClient from './StandingsClient'
import type {
  ParticipantWithTeamScore,
  DraftPickWithScores,
  PickupWithScores,
  CounterpickWithScores,
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

  // Parallelize independent queries (async-parallel optimization)
  //
  // Draft picks and pickups are filtered to what the team still holds, matching
  // the roster page and recalculate_team_score_with_counterpicks(). Counterpicks
  // deliberately are not: they survive a drop and keep scoring for the
  // counterpicker (see CLAUDE.md "Counterpicks x drops x trades").
  const [participantsResult, draftPicksResult, pickupsResult, counterpicksResult] = await Promise.all([
    supabase
      .from('league_participants')
      .select(
        `
        *,
        teams (
          *,
          team_scores (*),
          team_budgets (*)
        )
      `
      )
      .eq('league_id', id)
      .eq('status', 'active')
      .order('draft_order', { ascending: true }),
    supabase
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
      .is('dropped_at', null)
      .order('round', { ascending: true })
      .order('pick_number', { ascending: true }),
    supabase
      .from('pickups')
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
      .is('dropped_at', null)
      .order('picked_up_at', { ascending: true }),
    supabase
      .from('counterpicks')
      .select(
        `
        *,
        movies (
          *,
          reviews (*)
        ),
        target_team:teams!counterpicks_target_team_id_fkey (name)
      `
      )
      .eq('league_id', id)
      .order('pick_order', { ascending: true }),
  ])

  const { data: participants } = participantsResult
  const { data: draftPicks } = draftPicksResult
  const { data: pickups } = pickupsResult
  const { data: counterpicks } = counterpicksResult

  // Fetch profiles separately (no direct FK from league_participants)
  const userIds = (participants ?? []).map((p) => p.user_id)
  const { data: profiles } =
    userIds.length > 0
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

  return (
    <StandingsClient
      participants={participantsWithProfiles as ParticipantWithTeamScore[]}
      draftPicks={(draftPicks ?? []) as DraftPickWithScores[]}
      pickups={(pickups ?? []) as PickupWithScores[]}
      counterpicks={(counterpicks ?? []) as CounterpickWithScores[]}
      currentUserId={user.id}
      startingFaab={league.faab_budget ?? 0}
    />
  )
}
