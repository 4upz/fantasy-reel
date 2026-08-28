import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { fetchSeriesSeasonRecords, fetchStandings } from '@/utils/seasonQueries'
import { championName, championPoints, resolveChampions, seasonStandings } from '@/utils/seasons'
import SeasonHistoryList, {
  type SeasonHistoryRow,
} from '../components/SeasonHistoryList'
import type { League } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Every season of this league, newest first.
 *
 * A route rather than a panel on the dashboard: the dashboard is season-scoped
 * and already dense, while this is series-scoped and grows by one row a year
 * forever. It also gives the season menu's "All seasons" footer and the
 * champion banner's standings link somewhere to point.
 */
export default async function SeasonHistoryPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  const typedLeague = league as League
  const seasons = await fetchSeriesSeasonRecords(supabase, typedLeague.series_id)

  // Each completed season carries its own frozen table, so the whole page is
  // one query. The ranking RPC is only reached for a season that completed
  // before the snapshot column existed - normally never.
  const standingsBySeason = await Promise.all(
    seasons.map((season) =>
      season.status === 'completed' && !season.final_standings?.length
        ? fetchStandings(supabase, season.id)
        : Promise.resolve([])
    )
  )

  const rows: SeasonHistoryRow[] = seasons.map((season, index) => {
    const standings = seasonStandings(season.final_standings, standingsBySeason[index])
    const champions = resolveChampions(season.winner_team_ids, standings)

    return {
      leagueId: season.id,
      seasonYear: season.season_year,
      isCompleted: season.status === 'completed',
      champions: champions.map(championName),
      championPoints: championPoints(champions, standings),
      // Carries the real rank: a shared first place pushes the next team to
      // rank 3, and the row has to say 3rd when that happens.
      runnersUp:
        season.status === 'completed'
          ? standings
              .filter((row) => row.rank > 1)
              .slice(0, 2)
              .map((row) => ({ rank: row.rank, name: row.team_name }))
          : [],
      isCurrent: season.id === typedLeague.id,
    }
  })

  return (
    <div className="animate-fade-in">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {typedLeague.name}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          {seasons.length} {seasons.length === 1 ? 'season' : 'seasons'}
        </p>
      </header>

      <SeasonHistoryList rows={rows} />

      {seasons.length < 2 && (
        <p className="py-10 text-center text-sm text-foreground-muted">
          This is the league&apos;s first season. Past seasons show up here once one ends.
        </p>
      )}
    </div>
  )
}
