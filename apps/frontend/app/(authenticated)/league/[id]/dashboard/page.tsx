import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { getMovieStatus, extractScores } from '@/utils/league'
import type { League, DashboardTeam, MovieTimelineItem, Review } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DashboardPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
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
    notFound()
  }

  // Fetch all participants with teams and scores
  const { data: participants } = await supabase
    .from('league_participants')
    .select(`
      *,
      teams (
        *,
        team_scores (*)
      )
    `)
    .eq('league_id', id)
    .eq('status', 'active')

  // Fetch all draft picks with movies and reviews
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(`
      *,
      movies (
        *,
        reviews (*)
      )
    `)
    .eq('league_id', id)

  // Build team data
  const participantsData = participants || []
  const picksData = draftPicks || []

  // Calculate rankings for user's rank display
  const teamsWithScores = participantsData
    .filter((p) => p.teams)
    .map((p) => {
      const team = p.teams as { id: string; name: string; avatar_url: string | null; team_scores: { total_points: number } | null }
      return {
        participantUserId: p.user_id,
        teamId: team.id,
        total_points: team.team_scores?.total_points ?? 0,
      }
    })
    .sort((a, b) => b.total_points - a.total_points)

  // Build rank map with tie handling
  let currentRank = 1
  const rankMap = new Map<string, number>()
  teamsWithScores.forEach((t, idx, arr) => {
    const prevTeam = arr[idx - 1]
    const isTied = prevTeam && prevTeam.total_points === t.total_points
    if (!isTied && idx > 0) {
      currentRank = idx + 1
    }
    rankMap.set(t.teamId, currentRank)
  })

  // Find current user's team
  const userParticipant = participantsData.find((p) => p.user_id === user.id)
  let userTeam: DashboardTeam | null = null

  if (userParticipant?.teams) {
    const team = userParticipant.teams as {
      id: string
      name: string
      avatar_url: string | null
      team_scores: { total_points: number } | null
    }

    const userPicks = picksData.filter((p) => p.team_id === team.id)
    const movies: MovieTimelineItem[] = userPicks.map((pick) => {
      const movie = pick.movies as {
        id: string
        tmdb_id: number
        title: string
        poster_url: string | null
        release_date: string | null
        combined_score: number | null
        fantasy_points: number | null
        reviews: Review[]
      }

      return {
        id: movie.id,
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_date: movie.release_date,
        status: getMovieStatus(movie.release_date, movie.combined_score),
        combined_score: movie.combined_score,
        fantasy_points: movie.fantasy_points,
        scores: extractScores(movie.reviews || []),
      }
    })

    userTeam = {
      id: team.id,
      name: team.name,
      avatar_url: team.avatar_url,
      total_points: team.team_scores?.total_points ?? 0,
      rank: rankMap.get(team.id) ?? participantsData.length,
      movies,
    }
  }

  return (
    <DashboardClient
      league={league as League}
      userTeam={userTeam}
      totalTeams={participantsData.length}
    />
  )
}
