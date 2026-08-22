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

/** A counterpick row as the trade selector needs it. */
interface TradeableCounterpickRow {
  id: string
  movie_id: string
  fantasy_points: number | null
  movies: {
    title: string
    poster_url: string | null
    release_date: string | null
    combined_score: number | null
  } | null
  target_team: { name: string } | null
}

/**
 * Everything a team can put on the table in a trade: its whole current roster,
 * both draft picks and pickups, plus the counterpicks it owns.
 *
 * Counterpicks are not holdings and are not on `team_holdings` -- a team's bet
 * against someone else's movie never appears on its roster. They are a separate
 * read, merged in here so the trade UI has one list to select from and every
 * caller picks them up for free.
 */
export async function fetchTradeableMovies(
  supabase: SupabaseClient,
  teamId: string
): Promise<TradeableMovie[]> {
  const [{ data: holdings }, { data: counterpicks }] = await Promise.all([
    supabase
      .from('team_holdings')
      .select(
        'holding_id, source, movie_id, title, poster_url, release_date, combined_score, fantasy_points'
      )
      .eq('team_id', teamId)
      .order('source', { ascending: true })
      .order('acquired_at', { ascending: true }),
    supabase
      .from('counterpicks')
      .select(
        'id, movie_id, fantasy_points, movies(title, poster_url, release_date, combined_score), target_team:teams!counterpicks_target_team_id_fkey(name)'
      )
      .eq('counterpicker_team_id', teamId)
      .order('pick_order', { ascending: true }),
  ])

  const tradeableHoldings: TradeableMovie[] = ((holdings ?? []) as TradeableRow[]).map(
    (holding) => ({
      movie_id: holding.movie_id,
      source: holdingSourceName(holding.source),
      source_id: holding.holding_id,
      title: holding.title,
      poster_url: holding.poster_url,
      release_date: holding.release_date,
      combined_score: holding.combined_score,
      fantasy_points: holding.fantasy_points,
    })
  )

  const tradeableCounterpicks: TradeableMovie[] = (
    (counterpicks ?? []) as unknown as TradeableCounterpickRow[]
  ).map((counterpick) => ({
    movie_id: counterpick.movie_id,
    source: 'counterpick',
    source_id: counterpick.id,
    title: counterpick.movies?.title ?? 'Unknown Movie',
    poster_url: counterpick.movies?.poster_url ?? null,
    release_date: counterpick.movies?.release_date ?? null,
    combined_score: counterpick.movies?.combined_score ?? null,
    // counterpicks.fantasy_points is the INVERTED value the counterpicker
    // scores, which is the number that matters to whoever is trading for it --
    // not the movie's own fantasy_points that a roster row would show.
    fantasy_points: counterpick.fantasy_points,
    counterpick_target_team_name: counterpick.target_team?.name ?? null,
  }))

  return [...tradeableHoldings, ...tradeableCounterpicks]
}
