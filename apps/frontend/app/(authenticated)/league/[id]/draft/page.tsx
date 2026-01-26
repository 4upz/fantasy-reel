import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DraftClient from './DraftClient'
import type { League, ParticipantWithTeam, DraftPickWithDetails, CounterpickWithDetails } from '@/types'

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DraftPage({ params }: PageProps) {
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

  // Check if user is a participant
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
  const [participantsResult, draftPicksResult, counterpicksResult] =
    await Promise.all([
      supabase
        .from('league_participants')
        .select(`*, teams (*)`)
        .eq('league_id', id)
        .eq('status', 'active')
        .order('draft_order', { ascending: true }),
      // Explicit FK required: draft_picks has two FKs to teams (team_id, counterpicked_by_team_id)
      // Without explicit FK, PostgREST returns PGRST201 ambiguous relationship error
      supabase
        .from('draft_picks')
        .select(`*, movies (*), teams!draft_picks_team_id_fkey (*)`)
        .eq('league_id', id)
        .order('round', { ascending: true })
        .order('pick_number', { ascending: true }),
      supabase
        .from('counterpicks')
        .select('*, movies (*)')
        .eq('league_id', id)
        .order('pick_order', { ascending: true }),
    ])

  const { data: participants } = participantsResult
  const { data: draftPicks } = draftPicksResult
  const { data: counterpicks } = counterpicksResult

  const isOwner = league.owner_id === user.id

  return (
    <DraftClient
      league={league as League}
      participants={(participants || []) as ParticipantWithTeam[]}
      draftPicks={(draftPicks || []) as DraftPickWithDetails[]}
      counterpicks={(counterpicks || []) as CounterpickWithDetails[]}
      currentUserId={user.id}
      isOwner={isOwner}
    />
  )
}
