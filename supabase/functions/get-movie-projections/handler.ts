/**
 * Core logic for get-movie-projections, separate from index.ts so unit tests
 * can drive it with a mock client and a stub authenticator.
 *
 * The only way projections reach a client: movie_projections and
 * projection_models are service-role only, and this function applies the
 * `projections_display` gate (enabled AND the league's series allowlisted).
 * The gate is read first, so while the flag is off every call costs one
 * cached flag read and answers `{ enabled: false }`.
 *
 * Serves cached rows only. A league movie without a row (not yet in the
 * corpus, or not yet fitted) is null; nothing is computed on the request
 * path, so a call spends no TMDb or MDBList quota and needs no rate limit.
 * Add `consumeRateLimit` if cache misses ever compute on demand.
 */
import { errorResponse, hasReleased, isValidUUID, jsonResponse, utcDate } from '../_shared/utils.ts'
import { asFlagClient, flagAllowsSeries, getFlag } from '../_shared/feature-flags.ts'
import { fromProjectionRow, type MovieProjectionRow, toMovieProjection } from '../_shared/projection-model.ts'
import type { GetMovieProjectionsResponse, MovieProjection } from '../_shared/projection-types.ts'

export const DISPLAY_FLAG = 'projections_display'
export const MAX_TMDB_IDS = 100

type DbError = { message: string } | null

interface ProjectionQuery extends PromiseLike<{ data: unknown[] | null; error: DbError }> {
  eq(column: string, value: unknown): ProjectionQuery
  in(column: string, values: unknown[]): ProjectionQuery
  maybeSingle(): PromiseLike<{ data: unknown; error: DbError }>
}

/** Structural client slice (service role) so this module needs no esm.sh type import. */
export interface ProjectionsClient {
  from(table: string): { select(columns: string): ProjectionQuery }
}

export function asProjectionsClient(client: { from: unknown }): ProjectionsClient {
  return client as unknown as ProjectionsClient
}

export interface ProjectionsDeps {
  /** The signed-in caller's user id, or the 401/503 response to return. */
  authenticate(req: Request): Promise<{ userId: string } | Response>
  client: ProjectionsClient
  /** Today's UTC date (YYYY-MM-DD); injected so tests are deterministic. */
  today?: string
}

interface ParsedRequest {
  leagueId: string
  tmdbIds: number[]
}

/** The validated body, or the 400 to return. */
async function parseRequest(req: Request): Promise<ParsedRequest | Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('Request body must be JSON', 400)
  }
  const { league_id, tmdb_ids } = (body ?? {}) as { league_id?: unknown; tmdb_ids?: unknown }
  if (typeof league_id !== 'string' || !isValidUUID(league_id)) {
    return errorResponse('Valid league_id is required', 400)
  }
  if (
    !Array.isArray(tmdb_ids) || tmdb_ids.length === 0 || tmdb_ids.length > MAX_TMDB_IDS ||
    !tmdb_ids.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    return errorResponse(`tmdb_ids must be 1-${MAX_TMDB_IDS} positive integers`, 400)
  }
  return { leagueId: league_id, tmdbIds: [...new Set(tmdb_ids as number[])] }
}

/** A row's tmdb_id as a number, whatever PostgREST returned it as. */
const tmdbIdOf = (row: unknown) => Number((row as { tmdb_id: unknown }).tmdb_id)

export async function handleGetMovieProjections(req: Request, deps: ProjectionsDeps): Promise<Response> {
  const auth = await deps.authenticate(req)
  if (auth instanceof Response) return auth

  const parsed = await parseRequest(req)
  if (parsed instanceof Response) return parsed
  const { leagueId, tmdbIds } = parsed
  const { client } = deps

  // Gate first: while display is off this is all a call costs.
  const flag = await getFlag(asFlagClient(client), DISPLAY_FLAG)
  if (!flag.enabled) return jsonResponse({ enabled: false } satisfies GetMovieProjectionsResponse)

  const [league, participant] = await Promise.all([
    client.from('leagues').select('id, series_id, double_points_over_90').eq('id', leagueId).maybeSingle(),
    client
      .from('league_participants')
      .select('id')
      .eq('league_id', leagueId)
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle(),
  ])
  if (league.error) throw new Error(`leagues: ${league.error.message}`)
  if (participant.error) throw new Error(`league_participants: ${participant.error.message}`)
  // An unknown league answers like a foreign one, so ids cannot be probed.
  if (!league.data || !participant.data) return errorResponse('You are not a member of this league', 403)

  const { series_id, double_points_over_90 } = league.data as {
    series_id: string | null
    double_points_over_90: boolean | null
  }
  if (!flagAllowsSeries(flag, series_id)) return jsonResponse({ enabled: false } satisfies GetMovieProjectionsResponse)

  const [projectionRows, movieRows] = await Promise.all([
    client.from('movie_projections').select('*').in('tmdb_id', tmdbIds),
    client.from('movies').select('tmdb_id, release_date, fantasy_points').in('tmdb_id', tmdbIds),
  ])
  if (projectionRows.error) throw new Error(`movie_projections: ${projectionRows.error.message}`)
  if (movieRows.error) throw new Error(`movies: ${movieRows.error.message}`)

  // Released and scored: the real score has replaced the projection.
  const today = deps.today ?? utcDate()
  const settled = new Set(
    (movieRows.data ?? [])
      .filter((m) => {
        const movie = m as { release_date: string | null; fantasy_points: number | null }
        return movie.fantasy_points != null && hasReleased(movie.release_date, today)
      })
      .map(tmdbIdOf),
  )
  const rows = new Map(
    ((projectionRows.data ?? []) as Array<MovieProjectionRow & { frozen_at?: string | null }>)
      .filter((row) => row.frozen_at == null && !settled.has(tmdbIdOf(row)))
      .map((row) => [tmdbIdOf(row), row]),
  )

  const projections: Record<string, MovieProjection | null> = {}
  let modelVersion = 0
  for (const id of tmdbIds) {
    const row = rows.get(id)
    projections[String(id)] = row ? toMovieProjection(fromProjectionRow(row), double_points_over_90 === true) : null
    if (row) modelVersion = Math.max(modelVersion, Number(row.model_version))
  }

  return jsonResponse(
    { enabled: true, model_version: modelVersion, projections } satisfies GetMovieProjectionsResponse,
  )
}
