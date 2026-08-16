import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { buildTeamInfoByTeamId, getMovieStatus } from '@/utils/league'
import type {
  League,
  DashboardTeam,
  LeagueUpcomingRelease,
  MovieTimelineItem,
  ParticipantWithProfile,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * A holding row joined to the movie it holds, tagged with how it was acquired.
 * Only what the release board prints: it reads every holding in the league.
 */
interface UpcomingHolding {
  team_id: string
  source: LeagueUpcomingRelease['source']
  movies: {
    id: string
    tmdb_id: number
    title: string
    poster_url: string | null
    release_date: string | null
  } | null
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

  // The league's clock, as a date. Everything downstream compares YYYY-MM-DD
  // strings rather than Date objects: the board prints day numbers, and
  // `new Date('2026-09-18')` is UTC midnight, which renders as the 17th for
  // anyone west of UTC.
  const todayIso = new Date().toISOString().slice(0, 10)

  // `movies!inner` is what makes the release-date filter drop the holding row.
  // Without it PostgREST filters only the embed and hands back parent rows with
  // a null movie. Neither query embeds `teams`: both tables have two FKs to it
  // (team_id and counterpicked_by_team_id), so a bare embed is a PGRST201, and
  // the participants query below already knows every team's name.
  const upcomingHoldings = (table: 'draft_picks' | 'pickups') =>
    supabase
      .from(table)
      .select('team_id, movies!inner (id, tmdb_id, title, poster_url, release_date)')
      .eq('league_id', id)
      .is('dropped_at', null)
      .gte('movies.release_date', todayIso)

  const [
    { data: participants },
    { data: draftPicks },
    { data: upcomingPicks },
    { data: upcomingPickups },
  ] = await Promise.all([
    // Fetch all participants with teams and scores
    supabase
      .from('league_participants')
      .select(`
        *,
        teams (
          *,
          team_scores (*)
        ),
        profiles (display_name, avatar_url)
      `)
      .eq('league_id', id)
      .eq('status', 'active'),

    // Fetch all draft picks with movies. Dropped picks left the roster, so they
    // must not keep showing up on the owner's timeline.
    supabase
      .from('draft_picks')
      .select(`
        *,
        movies (*)
      `)
      .eq('league_id', id)
      .is('dropped_at', null),

    upcomingHoldings('draft_picks'),
    upcomingHoldings('pickups'),
  ])

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
        round: pick.round,
        pick_number: pick.pick_number,
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

  const leagueUpcoming = buildLeagueUpcoming(
    [
      ...toHoldings(upcomingPicks, 'draft_pick'),
      ...toHoldings(upcomingPickups, 'pickup'),
    ],
    buildTeamInfoByTeamId(participantsData as ParticipantWithProfile[]),
    userTeam?.id ?? null
  )

  return (
    <DashboardClient
      league={league as League}
      userTeam={userTeam}
      totalTeams={participantsData.length}
      leagueUpcoming={leagueUpcoming}
      todayIso={todayIso}
    />
  )
}

/** Tags a holding query's rows with the table they came from. */
function toHoldings(rows: unknown, source: UpcomingHolding['source']): UpcomingHolding[] {
  return ((rows ?? []) as UpcomingHolding[]).map((row) => ({ ...row, source }))
}

/**
 * Flattens both kinds of holding into one date-ordered league release list.
 *
 * A movie can only be held once, but nothing in the schema enforces that across
 * the two tables - only `is_movie_eligible_for_pickup()` does - so the merge
 * dedupes by movie and lets the draft pick win.
 */
function buildLeagueUpcoming(
  holdings: UpcomingHolding[],
  teamInfo: ReturnType<typeof buildTeamInfoByTeamId>,
  userTeamId: string | null
): LeagueUpcomingRelease[] {
  const byMovie = new Map<string, LeagueUpcomingRelease>()

  for (const { movies: movie, team_id, source } of holdings) {
    if (!movie?.release_date || byMovie.has(movie.id)) continue

    // A holding whose owner has since left the league is still worth showing -
    // the movie is still off the board - but there is no team name left for it.
    const info = teamInfo.get(team_id)

    byMovie.set(movie.id, {
      id: movie.id,
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      poster_url: movie.poster_url,
      release_date: movie.release_date,
      source,
      team_id,
      team_name: info?.teamName ?? 'Former team',
      owner_name: info?.ownerName ?? null,
      is_current_user_team: userTeamId != null && team_id === userTeamId,
    })
  }

  return [...byMovie.values()].sort(
    (a, b) => a.release_date.localeCompare(b.release_date) || a.title.localeCompare(b.title)
  )
}
