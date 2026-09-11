/**
 * Complete Seasons Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in handler.ts
 * (see that file for the full description and unit tests in
 * ../_shared/complete-seasons.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isAuthorizedCronRequest,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { runCompleteSeasons } from './handler.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'

const log = createLogger('complete-seasons')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    // Cron secret OR service role key -- mirrors release-day-announcements.
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('complete-seasons')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Season completion service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient
    const result = await runCompleteSeasons(serviceClient)

    // Only season completions count as items. A skipped season was already
    // closed by the commissioner, and reminders are reported in metadata --
    // neither should be able to make a clean run look degraded.
    const job_status = await run.finish(serviceClient, {
      processed: result.seasons_completed + result.seasons_failed,
      failed: result.seasons_failed,
      errors: result.errors,
      metadata: {
        reminders_sent: result.reminders_sent,
        seasons_skipped: result.seasons_skipped,
      },
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
