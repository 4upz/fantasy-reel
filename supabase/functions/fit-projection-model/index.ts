/**
 * Fit Projection Model Edge Function -- entrypoint.
 *
 * Vercel Cron -> /api/cron/fit-projection-model, monthly (10:00 UTC on the
 * 1st). Handles CORS, cron auth, the feature gate and env wiring; the job
 * itself lives in handler.ts (unit tests in
 * ../_shared/fit-projection-model.test.ts).
 *
 * Gated on `projections_ingestion`: fitting spends no API quota, but until
 * ingestion is on there is no corpus worth fitting, so the job is a no-op.
 * `projections_display` is not consulted -- fitting while display is off is
 * how the model gets ready to be judged.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  errorResponse,
  handleCorsPreflightRequest,
  internalErrorResponse,
  isAuthorizedCronRequest,
  jsonResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { type JobRun, type JobRunsClient, startJobRun } from '../_shared/job-runs.ts'
import { asFlagClient, getFlag } from '../_shared/feature-flags.ts'
import { asFitClient, runFitProjectionModel } from './handler.ts'

const log = createLogger('fit-projection-model')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('fit-projection-model')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Projection model service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    const flag = await getFlag(asFlagClient(serviceClient), 'projections_ingestion')
    if (!flag.enabled) {
      log.info('projections_ingestion flag disabled; skipping fit')
      const job_status = await run.finish(serviceClient, { processed: 0, failed: 0, metadata: { skipped: 'flag_disabled' } })
      return jsonResponse({ skipped: 'flag_disabled', job_status })
    }

    const result = await runFitProjectionModel(asFitClient(serviceClient), { now: new Date().toISOString() })

    if ('skipped' in result) {
      const job_status = await run.finish(serviceClient, { processed: 0, failed: 0, metadata: result })
      return jsonResponse({ ...result, job_status })
    }

    const { errors, failed, ...metadata } = result
    const job_status = await run.finish(serviceClient, {
      processed: result.targets - result.frozen_skipped,
      failed,
      errors,
      metadata,
    })
    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
