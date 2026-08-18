/**
 * Sync Release Dates Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in
 * handler.ts (see that file for the full description and unit tests in
 * ../_shared/sync-release-dates.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest, internalErrorResponse } from '../_shared/utils.ts'
import { runSyncReleaseDates } from './handler.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, purgeOldJobRuns, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import { purgeStaleTmdbCache } from '../_shared/tmdb-cache.ts'

const log = createLogger('sync-release-dates')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('sync-release-dates')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Release date sync service not configured', 503)
    }
    if (!tmdbToken) {
      log.error('TMDB_API_KEY not configured')
      return errorResponse('Release date sync service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient
    const result = await runSyncReleaseDates(serviceClient, tmdbToken)

    // Piggyback the job_runs retention purge on this daily cron -- as good a
    // place as any recurring job to keep the table bounded. Never throws;
    // a null count just means the purge itself failed (already logged).
    const purged = await purgeOldJobRuns(serviceClient)

    // Same deal for the TMDb response cache, and here retention is a licence
    // term, not just hygiene: TMDb forbids retaining their data past 6 months.
    // Also never throws; null means the purge itself failed (already logged).
    const tmdbCachePurged = await purgeStaleTmdbCache(serviceClient)

    // The handler logs and skips individual TMDb/update failures rather than
    // counting them, so there is no per-item failed counter to map.
    const job_status = await run.finish(serviceClient, {
      processed: result.movies_checked,
      failed: 0,
      metadata: {
        dates_changed: result.dates_changed,
        leagues_notified: result.leagues_notified,
        job_runs_purged: purged,
        tmdb_cache_purged: tmdbCachePurged,
      },
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
