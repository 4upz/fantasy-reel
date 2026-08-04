/**
 * Release Day Announcements Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in
 * handler.ts (see that file for the full description and unit tests in
 * ../_shared/release-day-announcements.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest } from '../_shared/utils.ts'
import { runReleaseDayAnnouncements } from './handler.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Cron secret OR service role key -- mirrors update-scores / process-bids.
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Release announcement service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    const result = await runReleaseDayAnnouncements(serviceClient)
    return jsonResponse(result)
  } catch (error) {
    console.error('Unexpected error in release-day-announcements:', error)
    return errorResponse('Internal server error', 500)
  }
})
