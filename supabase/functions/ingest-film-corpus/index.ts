/**
 * Ingest Film Corpus Edge Function -- entrypoint.
 *
 * Daily cron (Vercel Cron -> /api/cron/ingest-film-corpus, 09:00 UTC, after
 * the 06:00 score sync and 08:00 release-date sync so scoring has first
 * claim on the day's MDBList quota). Handles CORS, cron auth, the
 * projections_ingestion feature flag, and env wiring; business logic lives
 * in handler.ts (unit tests in ../_shared/ingest-film-corpus.test.ts).
 *
 * Operators pause this job from Supabase Studio -> feature_flags ->
 * projections_ingestion (enabled = false). No deploy needed.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import { getFlag, flagNumber, asFlagClient } from '../_shared/feature-flags.ts'
import { utcDay } from '../_shared/mdblist-budget.ts'
import { runIngestFilmCorpus, DEFAULT_INGEST_CONFIG } from './handler.ts'

const log = createLogger('ingest-film-corpus')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('ingest-film-corpus')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    const mdblistApiKey = Deno.env.get('MDBLIST_API_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Corpus ingestion service not configured', 503)
    }
    if (!tmdbToken || !mdblistApiKey) {
      log.error('TMDB_API_KEY or MDBLIST_API_KEY not configured')
      return errorResponse('Corpus ingestion service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    const flag = await getFlag(asFlagClient(serviceClient), 'projections_ingestion')
    if (!flag.enabled) {
      log.info('projections_ingestion flag disabled; skipping run')
      const job_status = await run.finish(serviceClient, { processed: 0, failed: 0, metadata: { skipped: 'flag_disabled' } })
      return jsonResponse({ skipped: 'flag_disabled', job_status })
    }

    const perRunCap = flagNumber(flag, 'per_run_cap', DEFAULT_INGEST_CONFIG.perRunCap)
    const result = await runIngestFilmCorpus(
      serviceClient,
      { tmdbToken, mdblistApiKey },
      {
        ...DEFAULT_INGEST_CONFIG,
        perRunCap,
        metadataPerRun: perRunCap * 3,
        dailyBudget: flagNumber(flag, 'mdblist_daily_budget', DEFAULT_INGEST_CONFIG.dailyBudget),
        today: utcDay(),
      }
    )

    const { errors, failed, ...metadata } = result
    const job_status = await run.finish(serviceClient, {
      processed: result.metadata_fetched + result.ratings_fetched + result.ratings_absent + failed,
      // A 429 is a degraded run even when nothing else failed: surface it in the ops channel.
      failed: failed + (result.mdblist_429 ? 1 : 0),
      errors,
      metadata,
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
