/**
 * Weekly Releases Digest Edge Function -- entrypoint.
 *
 * Handles CORS, cron auth, and env wiring; business logic lives in
 * handler.ts (see that file for the full description and unit tests in
 * ../_shared/weekly-releases-digest.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest } from '../_shared/utils.ts'
import { runWeeklyReleasesDigest } from './handler.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Weekly digest service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    const result = await runWeeklyReleasesDigest(serviceClient)
    return jsonResponse(result)
  } catch (error) {
    console.error('Unexpected error in weekly-releases-digest:', error)
    return errorResponse('Internal server error', 500)
  }
})
