import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  HoldingMovie,
  HoldingSource,
  HoldingSourceName,
  TeamHolding,
  TradeableMovie,
} from '@/types'

/**
 * Helpers for reading rosters off the `team_holdings` view.
 *
 * The view is the one read surface for what a team holds: draft picks and
 * auction wins in a single result, dropped rows already gone. Nothing here
 * should ever query `draft_picks` or `pickups` again - a reader that hits one
 * table alone is how auction wins kept going missing from rosters.
 */

/**
 * Every column a `team_holdings` read needs to rebuild the movie it holds.
 * Stays a literal: supabase-js parses the select string at the type level, and
 * a widened `string` makes the whole query untyped.
 */
export const HOLDING_MOVIE_COLUMNS =
  'movie_id, tmdb_id, title, overview, release_date, poster_url, movie_status, vote_average, popularity, combined_score, fantasy_points'

/** The column names in a `', '`-separated PostgREST select list. */
type ColumnsOf<S extends string> = S extends `${infer Head}, ${infer Rest}`
  ? Head | ColumnsOf<Rest>
  : S

/**
 * A view row selected with `HOLDING_MOVIE_COLUMNS`, read off the select string
 * itself so the two cannot drift -- naming a column here that isn't asked for
 * (or isn't on the view) is a `Pick` error.
 */
export type HoldingMovieRow = Pick<TeamHolding, ColumnsOf<typeof HOLDING_MOVIE_COLUMNS>>

/**
 * The view's `source` in base-table vocabulary. `team_holdings` says 'draft';
 * the trade tables and the dashboard's release board both say 'draft_pick'.
 */
export function holdingSourceName(source: HoldingSource): HoldingSourceName {
  return source === 'draft' ? 'draft_pick' : 'pickup'
}

/** The movie a holding is for, lifted out of the flat view row. */
export function holdingMovie(holding: HoldingMovieRow): HoldingMovie {
  return {
    id: holding.movie_id,
    tmdb_id: holding.tmdb_id,
    title: holding.title,
    overview: holding.overview,
    release_date: holding.release_date,
    poster_url: holding.poster_url,
    status: holding.movie_status,
    vote_average: holding.vote_average,
    popularity: holding.popularity,
    combined_score: holding.combined_score,
    fantasy_points: holding.fantasy_points,
  }
}

type TradeableRow = Pick<
  TeamHolding,
  | 'holding_id'
  | 'source'
  | 'movie_id'
  | 'title'
  | 'poster_url'
  | 'release_date'
  | 'combined_score'
  | 'fantasy_points'
>

/**
 * Everything a team can put on the table in a trade: its whole current roster,
 * both draft picks and pickups, in acquisition order.
 */
export async function fetchTradeableMovies(
  supabase: SupabaseClient,
  teamId: string
): Promise<TradeableMovie[]> {
  const { data } = await supabase
    .from('team_holdings')
    .select(
      'holding_id, source, movie_id, title, poster_url, release_date, combined_score, fantasy_points'
    )
    .eq('team_id', teamId)
    .order('source', { ascending: true })
    .order('acquired_at', { ascending: true })

  return ((data ?? []) as TradeableRow[]).map((holding) => ({
    movie_id: holding.movie_id,
    source: holdingSourceName(holding.source),
    source_id: holding.holding_id,
    title: holding.title,
    poster_url: holding.poster_url,
    release_date: holding.release_date,
    combined_score: holding.combined_score,
    fantasy_points: holding.fantasy_points,
  }))
}
