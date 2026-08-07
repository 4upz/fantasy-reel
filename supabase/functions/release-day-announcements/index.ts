/**
 * Release Day Announcements Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in
 * handler.ts (see that file for the full description and unit tests in
 * ../_shared/release-day-announcements.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest, internalErrorResponse } from '../_shared/utils.ts'
import { runReleaseDayAnnouncements } from './handler.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'

const log = createLogger('release-day-announcements')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    // Cron secret OR service role key -- mirrors update-scores / process-bids.
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('release-day-announcements')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Release announcement service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient
    const result = await runReleaseDayAnnouncements(serviceClient)

    // The handler logs and skips per-league failures rather than counting
    // them, so there is no per-item failed counter to map.
    const job_status = await run.finish(serviceClient, {
      processed: result.leagues_notified,
      failed: 0,
      metadata: { movies_announced: result.movies_announced },
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
