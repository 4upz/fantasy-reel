import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardClient from './DashboardClient'
import type {
  League,
  DashboardTeam,
  StandingEntry,
  MovieTimelineItem,
  Review,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

function getMovieStatus(
  releaseDate: string | null,
  combinedScore: number | null
): MovieTimelineItem['status'] {
  if (combinedScore !== null) return 'scored'

  if (!releaseDate) return 'upcoming'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffDays = Math.ceil((release.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays <= 30 && diffDays >= 0) return 'releasing_soon'
  return 'upcoming'
}

function extractScores(reviews: Review[]): MovieTimelineItem['scores'] {
  const scores: MovieTimelineItem['scores'] = {
    imdb: null,
    rotten_tomatoes: null,
    metacritic: null,
  }

  for (const review of reviews) {
    if (review.source === 'imdb') scores.imdb = review.score
    if (review.source === 'rotten_tomatoes') scores.rotten_tomatoes = review.score
    if (review.source === 'metacritic') scores.metacritic = review.score
  }

  return scores
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

  // Calculate rankings
  const teamsWithScores = participantsData
    .filter((p) => p.teams)
    .map((p) => {
      const team = p.teams as { id: string; name: string; avatar_url: string | null; team_scores: { total_points: number } | null }
      return {
        participantUserId: p.user_id,
        team: {
          id: team.id,
          name: team.name,
          avatar_url: team.avatar_url,
        },
        total_points: team.team_scores?.total_points ?? 0,
      }
    })
    .sort((a, b) => b.total_points - a.total_points)

  // Assign ranks with tie handling
  let currentRank = 1
  const standings: StandingEntry[] = teamsWithScores.map((t, idx, arr) => {
    const prevTeam = arr[idx - 1]
    const isTied = prevTeam && prevTeam.total_points === t.total_points

    if (!isTied && idx > 0) {
      currentRank = idx + 1
    }

    // Find top movie for this team
    const teamPicks = picksData.filter((p) => p.team_id === t.team.id)
    const topMovie = teamPicks
      .map((p) => ({ title: p.movies?.title, score: p.movies?.combined_score }))
      .filter((m) => m.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]

    return {
      rank: currentRank,
      isTied,
      team: t.team,
      total_points: t.total_points,
      topMovie: topMovie ? { title: topMovie.title, score: topMovie.score ?? 0 } : null,
      isCurrentUser: t.participantUserId === user.id,
    }
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
    const userStanding = standings.find((s) => s.team.id === team.id)

    const userPicks = picksData.filter((p) => p.team_id === team.id)
    const movies: MovieTimelineItem[] = userPicks.map((pick) => {
      const movie = pick.movies as {
        id: string
        tmdb_id: number
        title: string
        poster_url: string | null
        release_date: string | null
        combined_score: number | null
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
        scores: extractScores(movie.reviews || []),
      }
    })

    userTeam = {
      id: team.id,
      name: team.name,
      avatar_url: team.avatar_url,
      total_points: team.team_scores?.total_points ?? 0,
      rank: userStanding?.rank ?? participantsData.length,
      movies,
    }
  }

  return (
    <DashboardClient
      league={league as League}
      userTeam={userTeam}
      standings={standings}
      totalTeams={participantsData.length}
      currentUserId={user.id}
    />
  )
}
