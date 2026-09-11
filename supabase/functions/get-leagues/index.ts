import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'

const log = createLogger('get-leagues')

/** One season of a series, as the dashboard's season switcher lists them. */
interface SeasonSummary {
  id: string
  season_year: number
  status: string
}

/** The league identity that spans seasons. */
interface SeriesSummary {
  id: string
  name: string
  seasons: SeasonSummary[]
}

/**
 * Group the caller's leagues by series.
 *
 * Read with the caller's own client, not the service role: the seasons listed
 * are exactly the ones RLS already lets them see. Someone who joined in year
 * two gets year two onwards, which is the honest answer -- a season they were
 * never part of is not theirs to switch to.
 *
 * A series that cannot be read yields no entry rather than an error: the
 * league rows themselves are the response, and the grouping is a convenience
 * on top of them.
 */
async function loadSeriesSummaries(
  supabase: SupabaseClient,
  seriesIds: string[],
): Promise<Map<string, SeriesSummary>> {
  const summaries = new Map<string, SeriesSummary>()
  if (seriesIds.length === 0) return summaries

  const [seriesResult, seasonsResult] = await Promise.all([
    supabase.from('league_series').select('id, name').in('id', seriesIds),
    supabase
      .from('series_seasons')
      .select('league_id, series_id, season_year, status')
      .in('series_id', seriesIds)
      .order('season_year', { ascending: false }),
  ])

  if (seriesResult.error) {
    log.error('Error fetching league series', { error: serializeError(seriesResult.error) })
    return summaries
  }
  if (seasonsResult.error) {
    log.error('Error fetching series seasons', { error: serializeError(seasonsResult.error) })
  }

  for (const series of seriesResult.data ?? []) {
    summaries.set(series.id, { id: series.id, name: series.name, seasons: [] })
  }

  // Already ordered season_year DESC by the query, so pushing preserves it.
  for (const season of seasonsResult.data ?? []) {
    summaries.get(season.series_id)?.seasons.push({
      id: season.league_id,
      season_year: season.season_year,
      status: season.status,
    })
  }

  return summaries
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { supabase } = authResult

    // Get leagues for the user (RLS will handle filtering). `select('*')`
    // already carries the season columns -- series_id, season_year, season_end,
    // completed_at, winner_team_ids -- so only the series grouping is added.
    const { data: leagues, error: fetchError } = await supabase
      .from('leagues')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      log.error('Error fetching leagues', { error: serializeError(fetchError) })
      return errorResponse('Failed to fetch leagues', 500)
    }

    const seriesIds = [
      ...new Set((leagues ?? []).map((league) => league.series_id).filter(Boolean)),
    ] as string[]
    const summaries = await loadSeriesSummaries(supabase, seriesIds)

    // `series` is added alongside the existing fields, never in place of any of
    // them, so callers that predate seasons keep working unchanged. It is null
    // for a league whose series row the caller cannot read.
    const leaguesWithSeries = (leagues ?? []).map((league) => ({
      ...league,
      series: summaries.get(league.series_id) ?? null,
    }))

    return jsonResponse({ leagues: leaguesWithSeries })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
