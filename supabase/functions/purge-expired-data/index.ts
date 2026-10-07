/**
 * Purge Expired Data Edge Function (Vercel Cron, daily).
 *
 * Deletes old rows that hold personal data once nothing reads them any more:
 * email delivery records, dead invitations, old in-app notifications, delivered
 * draft notifications and finished seasons' Discord dedupe rows. The windows,
 * and what is never deleted, live in the `purge_expired_data` SQL function
 * (migration 20261004130700) so they are enforced in one transaction and
 * covered by supabase/tests/data_retention.sql.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isAuthorizedCronRequest,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'

const log = createLogger('purge-expired-data')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('purge-expired-data')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Data retention service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    const { data, error } = await serviceClient.rpc('purge_expired_data')
    if (error) throw error

    // { <table>: rows deleted, ..., more_remaining: boolean }
    const { more_remaining, ...deleted } = (data ?? {}) as Record<string, number | boolean>
    const processed = Object.values(deleted).reduce<number>((sum, n) => sum + (Number(n) || 0), 0)
    log.info('Purged expired data', { ...deleted, more_remaining })

    const job_status = await run.finish(serviceClient, {
      processed,
      failed: 0,
      errors: [],
      metadata: { deleted, more_remaining },
    })

    return jsonResponse({ deleted, more_remaining, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
