/**
 * Sync Release Dates Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in
 * handler.ts (see that file for the full description and unit tests in
 * ../_shared/sync-release-dates.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest } from '../_shared/utils.ts'
import { runSyncReleaseDates } from './handler.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const isAuthorizedByCron = cronSecret && req.headers.get('X-Cron-Secret') === cronSecret
    const isAuthorizedByServiceRole =
      serviceRoleKey && req.headers.get('Authorization') === `Bearer ${serviceRoleKey}`

    if (!isAuthorizedByCron && !isAuthorizedByServiceRole) {
      return errorResponse('Forbidden', 403)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Release date sync service not configured', 503)
    }
    if (!tmdbToken) {
      console.error('TMDB_API_KEY not configured')
      return errorResponse('Release date sync service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    const result = await runSyncReleaseDates(serviceClient, tmdbToken)
    return jsonResponse(result)
  } catch (error) {
    console.error('Unexpected error in sync-release-dates:', error)
    return errorResponse('Internal server error', 500)
  }
})
