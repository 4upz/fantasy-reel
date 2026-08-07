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

const log = createLogger('sync-release-dates')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

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
    const result = await runSyncReleaseDates(serviceClient, tmdbToken)
    return jsonResponse(result)
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
