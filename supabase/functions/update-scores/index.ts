import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, internalErrorResponse } from '../_shared/utils.ts'
import { COMPLETED_STATUS } from '../_shared/league-status.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import type { MovieRecord } from '../_shared/scoring.ts'
import { captureScoreContext, sendScoreNotifications } from '../_shared/score-notifications.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'

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
 * How many movies the nightly (no-argument) run will score.
 *
 * Unchanged from when this branch read `movies` directly; it is the ceiling
 * MDBList's rate limit and the Edge Function wall clock allow per night.
 */
const CRON_MOVIE_LIMIT = 30

/** How many candidate movies to examine per page while filling that batch. */
const CRON_CANDIDATE_PAGE_SIZE = 100

/**
 * How many candidate pages one run will scan.
 *
 * Frozen movies (see `frozenMovieIds`) keep whatever `scores_updated_at` they
 * had when their season ended, so they stay stale forever and sort to the
 * front of the candidate order. Without paging past them, a few finished
 * seasons' worth of movies would fill every batch and nothing else would ever
 * be scored again. Five pages is enough headroom for that to take years, and
 * bounds the work either way.
 */
const CRON_MAX_CANDIDATE_PAGES = 5

/**
 * Which of `candidateIds` no longer score.
 *
 * A movie freezes only when it is held **and every league holding it has
 * finished**. So:
 *   - a movie nobody holds (the bidding pool) keeps scoring;
 *   - a movie held in a finished season *and* a running one keeps scoring,
 *     because `movies.combined_score` belongs to the movie, not to a league;
 *   - only a movie whose holders are exclusively in finished seasons stops,
 *     since nothing that reads it can move any more.
 *
 * Fails open: if the holdings or the league statuses cannot be read, nothing
 * is reported frozen. Guessing the other way would silently halt scoring for
 * every league on one bad query.
 */
async function frozenMovieIds(
  serviceClient: SupabaseClient,
  candidateIds: string[],
): Promise<Set<string>> {
  const frozen = new Set<string>()
  if (candidateIds.length === 0) return frozen

  // Bounded by the page size, so the `in` list stays well inside the URI limit.
  const { data: holdings, error: holdingsError } = await serviceClient
    .from('team_holdings')
    .select('movie_id, league_id')
    .in('movie_id', candidateIds)

  if (holdingsError) {
    log.error('Error reading holdings for the freeze check', {
      error: serializeError(holdingsError),
    })
    return frozen
  }
  if (!holdings || holdings.length === 0) return frozen

  const holdingRows = holdings as Array<{ movie_id: string; league_id: string }>

  const { data: leagues, error: leaguesError } = await serviceClient
    .from('leagues')
    .select('id, status')
    .in('id', [...new Set(holdingRows.map((row) => row.league_id))])

  if (leaguesError) {
    log.error('Error reading league status for the freeze check', {
      error: serializeError(leaguesError),
    })
    return frozen
  }

  const completed = new Set(
    ((leagues ?? []) as Array<{ id: string; status: string }>)
      .filter((league) => league.status === COMPLETED_STATUS)
      .map((league) => league.id),
  )

  // One pass over the holdings: a movie stays a candidate for freezing only
  // while every holding seen so far is in a finished league.
  const stillFrozen = new Map<string, boolean>()
  for (const row of holdingRows) {
    const inFinishedSeason = completed.has(row.league_id)
    stillFrozen.set(row.movie_id, (stillFrozen.get(row.movie_id) ?? true) && inFinishedSeason)
  }

  for (const [movieId, isFrozen] of stillFrozen) {
    if (isFrozen) frozen.add(movieId)
  }

  return frozen
}

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
      // Default: refresh released movies that are due a score, skipping only
      // those that can no longer matter -- held, with every holding league
      // finished. See `frozenMovieIds` for why the unit of exclusion is the
      // movie's full set of holders rather than any single league.
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const today = new Date().toISOString().split('T')[0]
      const collected: MovieRecord[] = []

      // Paged rather than a single `.limit()`: the frozen movies are filtered
      // out *after* the database has chosen the page, so a page can yield
      // fewer than expected and the next one has to be reachable.
      for (
        let page = 0;
        page < CRON_MAX_CANDIDATE_PAGES && collected.length < CRON_MOVIE_LIMIT;
        page++
      ) {
        const from = page * CRON_CANDIDATE_PAGE_SIZE

        const { data, error } = await serviceClient
          .from('movies')
          .select('id, tmdb_id, imdb_id, title')
          .lte('release_date', today)
          .neq('status', 'canceled')
          .or(`scores_updated_at.is.null,scores_updated_at.lt.${oneDayAgo.toISOString()}`)
          // A total order is what makes `.range()` paging coherent; least
          // recently scored first also drains a backlog instead of re-reading
          // the same rows nightly. `id` breaks ties so pages cannot overlap.
          .order('scores_updated_at', { ascending: true, nullsFirst: true })
          .order('id', { ascending: true })
          .range(from, from + CRON_CANDIDATE_PAGE_SIZE - 1)

        if (error) {
          log.error('Error fetching movies', { error: serializeError(error) })
          return errorResponse('Failed to fetch movies', 500)
        }

        const candidates = (data as MovieRecord[]) ?? []
        if (candidates.length === 0) break

        const frozen = await frozenMovieIds(serviceClient, candidates.map((movie) => movie.id))

        for (const movie of candidates) {
          if (frozen.has(movie.id)) continue
          collected.push(movie)
          if (collected.length >= CRON_MOVIE_LIMIT) break
        }

        // A short page is the last page.
        if (candidates.length < CRON_CANDIDATE_PAGE_SIZE) break
      }

      moviesToUpdate = collected
    }

    if (moviesToUpdate.length === 0) {
      const job_status = await run.finish(serviceClient, { processed: 0, failed: 0 })
      return jsonResponse({
        movies_fetched: 0,
        scores_updated: 0,
        errors: [],
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

    const results = {
      movies_fetched: 0,
      scores_updated: 0,
      errors: [] as Array<{ movie_id: string; title: string; error: string }>
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
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: fetchError
          })
          continue
        }

        if (ratings.length === 0) {
          results.errors.push({
            movie_id: movie.id,
            title: movie.title,
            error: 'No ratings available'
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
            // the movie stays unscored under RT-only scoring. Not an error - it
            // just must not be counted as a score update.
            log.info('No Rotten Tomatoes score; left unscored', { movie_title: movie.title })
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

    const job_status = await run.finish(serviceClient, {
      processed: moviesToUpdate.length,
      failed: results.errors.length,
      errors: results.errors,
      metadata: {
        movies_fetched: results.movies_fetched,
        scores_updated: results.scores_updated,
        notifications,
        ...truncation,
      },
    })

    return jsonResponse({ ...results, ...truncation, notifications, job_status })

  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
