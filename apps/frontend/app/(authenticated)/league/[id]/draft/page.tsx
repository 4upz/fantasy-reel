import { createClient } from '@/utils/supabase/server'
import { getCachedActiveParticipant, getCachedLeague, getCachedUser } from '@/utils/supabase/cached'
import { redirect, notFound } from 'next/navigation'
import DraftClient from './DraftClient'
import { fetchReigningChampions } from '@/utils/seasonQueries'
import type { League, ParticipantWithProfile, DraftPickWithDetails, CounterpickWithDetails } from '@/types'

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DraftPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: { user } }, { data: league, error: leagueError }] = await Promise.all([
    getCachedUser(),
    getCachedLeague(id),
  ])
  if (!user) {
    redirect('/login')
  }

  if (leagueError && leagueError.code !== 'PGRST116') {
    throw new Error('Unable to load the draft. Please try again.', { cause: leagueError })
  }
  if (!league) {
    notFound()
  }

  // Check if user is a participant
  const { data: userParticipant, error: participantError } = await getCachedActiveParticipant(id, user.id)

  if (participantError && participantError.code !== 'PGRST116') {
    throw new Error('Unable to check draft membership. Please try again.', { cause: participantError })
  }
  if (!userParticipant) {
    redirect('/dashboard')
  }

  const typedLeague = league as League

  // Parallelize independent queries (async-parallel optimization)
  const [participantsResult, draftPicksResult, counterpicksResult, reigningChampions] =
    await Promise.all([
      supabase
        .from('league_participants')
        .select(`*, teams (*), profiles (*)`)
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
      fetchReigningChampions(supabase, typedLeague),
    ])

  const loadError = [participantsResult, draftPicksResult, counterpicksResult].find(result => result.error)?.error
  if (loadError) throw new Error('Unable to load the draft. Please try again.', { cause: loadError })

  const { data: participants } = participantsResult
  const { data: draftPicks } = draftPicksResult
  const { data: counterpicks } = counterpicksResult

  const isOwner = league.owner_id === user.id

  return (
    <DraftClient
      league={typedLeague}
      participants={(participants || []) as ParticipantWithProfile[]}
      draftPicks={(draftPicks || []) as DraftPickWithDetails[]}
      counterpicks={(counterpicks || []) as CounterpickWithDetails[]}
      currentUserId={user.id}
      isOwner={isOwner}
      reigningChampions={reigningChampions}
    />
  )
}
