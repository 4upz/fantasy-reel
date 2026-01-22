import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DraftClient from './DraftClient'
import type { League, ParticipantWithTeam, DraftPickWithDetails } from '@/types'

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

  // Fetch participants with their teams
  const { data: participants } = await supabase
    .from('league_participants')
    .select(`*, teams (*)`)
    .eq('league_id', id)
    .eq('status', 'active')
    .order('draft_order', { ascending: true })

  // Fetch draft picks with movie and team info
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(`*, movies (*), teams (*)`)
    .eq('league_id', id)
    .order('round', { ascending: true })
    .order('pick_number', { ascending: true })

  const isOwner = league.owner_id === user.id

  return (
    <DraftClient
      league={league as League}
      participants={(participants || []) as ParticipantWithTeam[]}
      draftPicks={(draftPicks || []) as DraftPickWithDetails[]}
      currentUserId={user.id}
      isOwner={isOwner}
    />
  )
}
