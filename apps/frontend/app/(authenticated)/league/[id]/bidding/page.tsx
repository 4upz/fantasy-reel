import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BiddingClient from './BiddingClient'
import type { League } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function BiddingPage({ params }: PageProps) {
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

  // Bidding only available for active leagues
  if (league.status !== 'active') {
    redirect(`/league/${id}`)
  }

  // Parallelize independent queries (async-parallel optimization)
  const [participantResult, draftPicksResult] = await Promise.all([
    supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single(),
    supabase.from('draft_picks').select(`*, movies (tmdb_id)`).eq('league_id', id),
  ])

  const { data: participant } = participantResult
  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as { id: string } | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  const { data: draftPicks } = draftPicksResult

  const draftedTmdbIds = (draftPicks || [])
    .map((p) => p.movies?.tmdb_id)
    .filter((id): id is number => typeof id === 'number')

  return (
    <BiddingClient
      league={league as League}
      teamId={team.id}
      draftedTmdbIds={draftedTmdbIds}
    />
  )
}
