/**
 * Bid Cutoff Announcement Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in handler.ts
 * (see that file for the full description and unit tests in
 * ../_shared/bid-cutoff-announcement.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isAuthorizedCronRequest,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { runBidCutoffAnnouncement } from './handler.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'

const log = createLogger('bid-cutoff-announcement')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('bid-cutoff-announcement')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Bid cutoff announcement service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    // Optional league_id scopes a manual run to one league, for testing.
    let targetLeagueId: string | undefined
    try {
      const body = await req.json()
      if (body && typeof body.league_id === 'string') targetLeagueId = body.league_id
    } catch {
      // No body, or not JSON -- the scheduled case.
    }

    const result = await runBidCutoffAnnouncement(serviceClient, new Date(), targetLeagueId)

    const job_status = await run.finish(serviceClient, {
      processed: result.leagues_announced,
      failed: result.failed,
      errors: result.errors.map((e) => `${e.league_id}: ${e.error}`),
      metadata: {
        leagues_skipped: result.leagues_skipped,
        bids_summarized: result.bids_summarized,
      },
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
