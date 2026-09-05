import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, internalErrorResponse } from '../_shared/utils.ts'
import { fetchMDBListRatings, MDBLIST_NOT_FOUND } from '../_shared/scoring.ts'
import type { MovieRecord } from '../_shared/scoring.ts'
import { captureScoreContext, sendScoreNotifications } from '../_shared/score-notifications.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import { alertOps } from '../_shared/ops-alerts.ts'

const log = createLogger('update-scores')

interface UpdateScoresRequest {
  movie_ids?: string[]
  league_id?: string
}

/** The team_holdings columns needed to build a MovieRecord. */
interface HoldingRow {
  movie_id: string
  tmdb_id: number
  imdb_id: string | null
  title: string
}

function parseRequestBody(body: string): UpdateScoresRequest {
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    return {}
  }
}

/**
 * Ceiling on how many movies one invocation will score.
 *
 * The nightly cron branch has always had its own `.limit(30)`; the explicit
 * `movie_ids[]` and `league_id` branches had none, so a large league (or a
 * caller passing every movie it knows about) could fan out into hundreds of
 * sequential MDBList lookups in a single request -- past the Edge Function
 * wall clock and well into MDBList's rate limit. Callers needing more can
 * invoke again; nothing here is stateful across invocations.
 */
const MAX_MOVIES_PER_RUN = 100

/**
 * Truncation is reported in-band (response body and job_runs metadata), not
 * just logged: a caller that asked for 250 movies and silently got 100 scored
 * has no way to know it must invoke again.
 */
interface Truncation {
  truncated: true
  remaining: number
}

function capMovies(
  movies: MovieRecord[],
  source: string
): { movies: MovieRecord[]; truncation?: Truncation } {
  if (movies.length <= MAX_MOVIES_PER_RUN) return { movies }

  const remaining = movies.length - MAX_MOVIES_PER_RUN
  log.warn('Movie batch capped', {
    source,
    requested: movies.length,
    processed: MAX_MOVIES_PER_RUN,
    dropped: remaining,
  })
  return { movies: movies.slice(0, MAX_MOVIES_PER_RUN), truncation: { truncated: true, remaining } }
}

/** How many movies the nightly (no-body) mode scores per run. */
const AUTO_BATCH_LIMIT = 30

/**
 * Backlog visibility for the nightly mode: how many eligible movies this run
 * could see vs. how many it was allowed to take.
 *
 * A nonzero backlog is normal — a release-heavy week queues more than one
 * batch, and it drains at AUTO_BATCH_LIMIT per run. What throughput metrics
 * alone can never show is a backlog that GROWS run over run: that was the
 * signature of the batch-starvation bug (every run reported 30 processed, ok,
 * while newly released movies never got their first score). Recording
 * eligible/backlog in job_runs metadata makes that gap observable, and
 * alertIfBacklogGrowing turns sustained growth into an ops ping.
 */
type BacklogMetrics = {
  eligible: number
  backlog: number
}

/**
 * Ping ops when the nightly backlog is more than a full batch behind AND
 * worse than the previous instrumented run. Draining (shrinking) backlogs and
 * ordinary spikes stay quiet; sustained growth alerts on every run while it
 * lasts (at most twice a day). Best-effort: never throws, never blocks the
 * run's outcome.
 */
async function alertIfBacklogGrowing(client: SupabaseClient, metrics: BacklogMetrics): Promise<void> {
  if (metrics.backlog <= AUTO_BATCH_LIMIT) return

  try {
    const { data, error } = await client
      .from('job_runs')
      .select('metadata')
      .eq('job_name', 'update-scores')
      .not('metadata->backlog', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)

    if (error) throw error

    // Stay quiet with no instrumented baseline to compare against, or when
    // this run is no worse than the last one.
    const previous = (data?.[0]?.metadata as { backlog?: unknown } | undefined)?.backlog
    if (typeof previous !== 'number' || metrics.backlog <= previous) return

    await alertOps('update-scores backlog growing', {
      eligible: metrics.eligible,
      backlog: metrics.backlog,
      previous_backlog: previous,
      batch_limit: AUTO_BATCH_LIMIT,
    })
  } catch (err) {
    log.warn('Backlog growth check failed', { error: serializeError(err) })
  }
}

/**
 * Stamp scores_updated_at without scoring: this run learned everything it can
 * about the movie, and the answer was "no score" -- there is no TMDb id to look
 * up, or MDBList answered authoritatively that it has no entry / no ratings.
 *
 * Left NULL, such a movie re-qualifies for the default batch on every run and
 * sorts to its front under NULLS FIRST, permanently occupying a slot. Stamping
 * sends it to the back of the queue like any processed movie, so it retries
 * daily instead of every run. Transient failures (network errors, rate limits)
 * deliberately stay unstamped so they retry on the next run.
 */
async function markScoreChecked(client: SupabaseClient, movie: MovieRecord): Promise<void> {
  const { error } = await client
    .from('movies')
    .update({ scores_updated_at: new Date().toISOString() })
    .eq('id', movie.id)

  if (error) {
    log.warn('Failed to stamp scores_updated_at', { movie_title: movie.title, error: serializeError(error) })
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    // Verify caller is authorized (cron secret OR service role key)
    const cronSecret = Deno.env.get('CRON_SECRET')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const isAuthorizedByCron = cronSecret && req.headers.get('X-Cron-Secret') === cronSecret
    const isAuthorizedByServiceRole =
      serviceRoleKey && req.headers.get('Authorization') === `Bearer ${serviceRoleKey}`

    if (!isAuthorizedByCron && !isAuthorizedByServiceRole) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('update-scores')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Score update service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    const params = req.method === 'POST'
      ? parseRequestBody(await req.text())
      : {}

    let moviesToUpdate: MovieRecord[] = []
    let truncation: Truncation | undefined
    let backlogMetrics: BacklogMetrics | undefined

    if (params.movie_ids && params.movie_ids.length > 0) {
      // Update specific movies
      const validIds = [...new Set(params.movie_ids.filter(id => isValidUUID(id)))]
      if (validIds.length === 0) {
        return errorResponse('No valid movie_ids provided', 400)
      }

      const { data, error } = await serviceClient
        .from('movies')
        .select('id, tmdb_id, imdb_id, title')
        .in('id', validIds)

      if (error) {
        log.error('Error fetching movies', { error: serializeError(error) })
        return errorResponse('Failed to fetch movies', 500)
      }

      const capped = capMovies((data as MovieRecord[]) || [], 'movie_ids')
      moviesToUpdate = capped.movies
      truncation = capped.truncation
    } else if (params.league_id) {
      // Update movies currently rostered in a specific league. team_holdings
      // covers both acquisition paths; reading draft_picks alone left every
      // auction pickup out of the league's score refresh.
      if (!isValidUUID(params.league_id)) {
        return errorResponse('Invalid league_id', 400)
      }

      const { data, error } = await serviceClient
        .from('team_holdings')
        .select('movie_id, tmdb_id, imdb_id, title')
        .eq('league_id', params.league_id)

      if (error) {
        log.error('Error fetching league holdings', { error: serializeError(error) })
        return errorResponse('Failed to fetch rostered movies', 500)
      }

      // At most one team holds a movie per league, but collapse by movie id
      // anyway so a duplicate could never double the MDBList lookups.
      const byMovieId = new Map<string, MovieRecord>()
      for (const row of (data ?? []) as HoldingRow[]) {
        byMovieId.set(row.movie_id, {
          id: row.movie_id,
          tmdb_id: row.tmdb_id,
          imdb_id: row.imdb_id,
          title: row.title,
        })
      }
      const capped = capMovies([...byMovieId.values()], 'league_id')
      moviesToUpdate = capped.movies
      truncation = capped.truncation
    } else {
      // Default: find released drafted movies needing score updates.
      //
      // The ordering is what guarantees every eligible movie eventually gets a
      // turn. More movies can qualify than the limit allows (every released
      // movie re-qualifies daily), and an unordered LIMIT lets Postgres return
      // an arbitrary-but-stable subset -- in practice the oldest rows, which
      // starved newly released movies of their first score indefinitely.
      // NULLS FIRST puts never-checked movies at the front; processing stamps
      // scores_updated_at, sending each movie to the back of the queue.
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      // count: 'exact' rides along on the same request and reports how many
      // rows matched BEFORE the limit -- the eligible set this run can see.
      const { data, error, count } = await serviceClient
        .from('movies')
        .select('id, tmdb_id, imdb_id, title', { count: 'exact' })
        .lte('release_date', new Date().toISOString().split('T')[0])
        .neq('status', 'canceled')
        .or(`scores_updated_at.is.null,scores_updated_at.lt.${oneDayAgo.toISOString()}`)
        .order('scores_updated_at', { ascending: true, nullsFirst: true })
        .limit(AUTO_BATCH_LIMIT)

      if (error) {
        log.error('Error fetching movies', { error: serializeError(error) })
        return errorResponse('Failed to fetch movies', 500)
      }

      moviesToUpdate = (data as MovieRecord[]) || []
      if (typeof count === 'number') {
        backlogMetrics = {
          eligible: count,
          backlog: Math.max(0, count - moviesToUpdate.length),
        }
      }
    }

    if (moviesToUpdate.length === 0) {
      // Still record backlog metrics on quiet runs so the growth baseline
      // resets to 0 instead of lingering at the last busy run's value
      const job_status = await run.finish(serviceClient, {
        processed: 0,
        failed: 0,
        metadata: backlogMetrics,
      })
      return jsonResponse({
        movies_fetched: 0,
        scores_updated: 0,
        errors: [],
        unscored: [],
        job_status
      })
    }

    // Only require MDBLIST_API_KEY when there are movies that need external score lookups
    const mdblistApiKey = Deno.env.get('MDBLIST_API_KEY')
    const needsApiKey = moviesToUpdate.some(m => m.tmdb_id > 0)
    if (needsApiKey && !mdblistApiKey) {
      log.error('MDBLIST_API_KEY not configured')
      return errorResponse('Score update service not configured', 503)
    }

    // `errors` holds genuine failures (network, auth, rate limit, upsert, RPC)
    // and drives job_status -- a non-ok status is relayed as HTTP 500 by the
    // cron proxy and fires an ops alert. `unscored` holds the expected pending
    // states: MDBList answered fine but has no score for the movie yet. A new
    // or obscure release waiting on its Tomatometer is not a degraded run, so
    // it must not turn the cron red; it is still reported (response body and
    // job_runs metadata) so a movie stuck pending forever remains findable.
    const results = {
      movies_fetched: 0,
      scores_updated: 0,
      errors: [] as Array<{ movie_id: string; title: string; error: string }>,
      unscored: [] as Array<{ movie_id: string; title: string; reason: string }>
    }

    // Snapshot scores and standings before recalculation so we can report
    // exactly what moved once the run finishes
    const scoreContext = await captureScoreContext(
      serviceClient,
      moviesToUpdate.map(m => m.id)
    )

    // Process each movie
    for (const movie of moviesToUpdate) {
      if (!movie.tmdb_id) {
        // Unscoreable until someone fixes the row; stamp so it can't hog a
        // batch slot every run
        await markScoreChecked(serviceClient, movie)
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'No TMDb ID available'
        })
        continue
      }

      try {
        const { ratings, error: fetchError } = await fetchMDBListRatings(movie.tmdb_id, mdblistApiKey)

        if (fetchError) {
          if (fetchError === MDBLIST_NOT_FOUND) {
            // MDBList definitively has no entry: pending, not a failure
            await markScoreChecked(serviceClient, movie)
            results.unscored.push({
              movie_id: movie.id,
              title: movie.title,
              reason: 'not_on_mdblist'
            })
          } else {
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: fetchError
            })
          }
          continue
        }

        if (ratings.length === 0) {
          await markScoreChecked(serviceClient, movie)
          results.unscored.push({
            movie_id: movie.id,
            title: movie.title,
            reason: 'no_ratings'
          })
          continue
        }

        results.movies_fetched++

        // Batch all valid ratings into a single upsert
        const now = new Date().toISOString()
        const reviewRows = ratings
          .filter((r) => r.source && r.score !== null)
          .map((r) => ({
            movie_id: movie.id,
            source: r.source,
            score: r.score,
            raw_score: r.raw,
            fetched_at: now,
          }))

        let ratingsStored = 0
        if (reviewRows.length > 0) {
          const { error: reviewError } = await serviceClient
            .from('reviews')
            .upsert(reviewRows, { onConflict: 'movie_id,source' })

          if (reviewError) {
            log.error('Error upserting reviews', { movie_title: movie.title, error: serializeError(reviewError) })
          } else {
            ratingsStored = reviewRows.length
          }
        }

        // Calculate fantasy points via PostgreSQL function
        // This also cascades to recalculate_teams_for_movie() and updates scores_updated_at
        if (ratingsStored > 0) {
          const { data: fantasyPts, error: calcError } = await serviceClient.rpc(
            'calculate_movie_score',
            { p_movie_id: movie.id }
          )

          if (calcError) {
            log.error('Score calculation failed', { movie_title: movie.title, error: serializeError(calcError) })
            results.errors.push({
              movie_id: movie.id,
              title: movie.title,
              error: 'Score calculation failed'
            })
          } else if (fantasyPts === null) {
            // Ratings were stored, but none of them was a Tomatometer score, so
            // the movie stays unscored under RT-only scoring: pending, not a
            // score update and not a failure.
            log.info('No Rotten Tomatoes score; left unscored', { movie_title: movie.title })
            results.unscored.push({
              movie_id: movie.id,
              title: movie.title,
              reason: 'no_rt_score'
            })
          } else {
            log.info('Calculated score', { movie_title: movie.title, fantasy_points: fantasyPts })
            results.scores_updated++
          }
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 50))

      } catch (error) {
        log.error('Error processing movie', { movie_title: movie.title, error: serializeError(error) })
        results.errors.push({
          movie_id: movie.id,
          title: movie.title,
          error: 'Failed to fetch or process ratings'
        })
      }
    }

    // Must be awaited -- the runtime may abort in-flight fetches after we respond
    const notifications = await sendScoreNotifications(serviceClient, scoreContext)

    // Reads the PREVIOUS run's recorded backlog, so it must happen before
    // run.finish inserts this run's row
    if (backlogMetrics) {
      await alertIfBacklogGrowing(serviceClient, backlogMetrics)
    }

    const job_status = await run.finish(serviceClient, {
      processed: moviesToUpdate.length,
      failed: results.errors.length,
      errors: results.errors,
      metadata: {
        movies_fetched: results.movies_fetched,
        scores_updated: results.scores_updated,
        notifications,
        ...(results.unscored.length > 0 ? { unscored: results.unscored } : {}),
        ...backlogMetrics,
        ...truncation,
      },
    })

    return jsonResponse({ ...results, ...backlogMetrics, ...truncation, notifications, job_status })

  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
