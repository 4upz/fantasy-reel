import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { buildTeamInfoByTeamId, getMovieStatus } from '@/utils/league'
import { holdingSourceName } from '@/utils/holdings'
import type {
  League,
  DashboardTeam,
  LeagueUpcomingRelease,
  MovieTimelineItem,
  ParticipantWithProfile,
  TeamHolding,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * The `team_holdings` columns this page selects. One read serves both surfaces:
 * the owner's movie timeline and the league-wide release board.
 */
type DashboardHolding = Pick<
  TeamHolding,
  | 'team_id'
  | 'source'
  | 'round'
  | 'pick_number'
  | 'amount_paid'
  | 'movie_id'
  | 'tmdb_id'
  | 'title'
  | 'poster_url'
  | 'release_date'
  | 'combined_score'
  | 'fantasy_points'
>

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

  const [{ data: participants }, { data: holdingRows }] = await Promise.all([
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

    // Every movie still held in the league, drafted or won at auction. The view
    // has already dropped what teams let go, and 'draft' sorts before 'pickup'
    // so the release board's dedupe keeps letting the draft pick win.
    supabase
      .from('team_holdings')
      .select(
        'team_id, source, round, pick_number, amount_paid, movie_id, tmdb_id, title, poster_url, release_date, combined_score, fantasy_points'
      )
      .eq('league_id', id)
      .order('source', { ascending: true }),
  ])

  // Build team data
  const participantsData = participants || []
  const holdings = (holdingRows ?? []) as DashboardHolding[]

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

    const movies: MovieTimelineItem[] = holdings
      .filter((holding) => holding.team_id === team.id)
      .map((holding) => ({
        id: holding.movie_id,
        tmdb_id: holding.tmdb_id,
        title: holding.title,
        poster_url: holding.poster_url,
        release_date: holding.release_date,
        status: getMovieStatus(holding.release_date, holding.combined_score),
        combined_score: holding.combined_score,
        fantasy_points: holding.fantasy_points,
        source: holding.source,
        round: holding.round,
        pick_number: holding.pick_number,
        amount_paid: holding.amount_paid,
      }))

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
    holdings,
    buildTeamInfoByTeamId(participantsData as ParticipantWithProfile[]),
    userTeam?.id ?? null,
    todayIso
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

/**
 * Flattens the league's still-unreleased holdings into one date-ordered list.
 * Undated holdings and ones that have already opened are not "upcoming".
 *
 * A movie can only be held once, but nothing in the schema enforces that across
 * draft picks and pickups - only `is_movie_eligible_for_pickup()` does - so the
 * merge dedupes by movie and lets the draft pick win.
 */
function buildLeagueUpcoming(
  holdings: DashboardHolding[],
  teamInfo: ReturnType<typeof buildTeamInfoByTeamId>,
  userTeamId: string | null,
  todayIso: string
): LeagueUpcomingRelease[] {
  const byMovie = new Map<string, LeagueUpcomingRelease>()

  for (const holding of holdings) {
    if (!holding.release_date || holding.release_date < todayIso) continue
    if (byMovie.has(holding.movie_id)) continue

    // A holding whose owner has since left the league is still worth showing -
    // the movie is still off the board - but there is no team name left for it.
    const info = teamInfo.get(holding.team_id)

    byMovie.set(holding.movie_id, {
      id: holding.movie_id,
      tmdb_id: holding.tmdb_id,
      title: holding.title,
      poster_url: holding.poster_url,
      release_date: holding.release_date,
      source: holdingSourceName(holding.source),
      team_id: holding.team_id,
      team_name: info?.teamName ?? 'Former team',
      owner_name: info?.ownerName ?? null,
      is_current_user_team: userTeamId != null && holding.team_id === userTeamId,
    })
  }

  return [...byMovie.values()].sort(
    (a, b) => a.release_date.localeCompare(b.release_date) || a.title.localeCompare(b.title)
  )
}
