/**
 * Send Announcement Edge Function -- entrypoint.
 *
 * Handles CORS and JWT auth; business logic lives in handler.ts (see that
 * file for the full description and unit tests in
 * ../_shared/send-announcement.test.ts).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'
import { runSendAnnouncement, type SendAnnouncementRequest } from './handler.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase } = authResult

    const body: SendAnnouncementRequest = await req.json().catch(() => ({}))

    // Discord delivery needs the service role client -- discord_channels.webhook_url
    // is a credential column, matching every other notification-sending function.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { status, result } = await runSendAnnouncement(supabase, serviceClient, user.id, body)

    if ('error' in result) {
      return errorResponse(result.error, status)
    }
    return jsonResponse(result, status)
  } catch (error) {
    console.error('Unexpected error in send-announcement:', error)
    return errorResponse('Internal server error', 500)
  }
})
