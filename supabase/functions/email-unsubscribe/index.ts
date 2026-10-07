/**
 * Email Unsubscribe Edge Function.
 *
 * Turns off season recap emails for whoever holds the token. Called two ways,
 * both POST with `?token=` (see _shared/email-preferences.ts):
 *  - by mail clients, for the one-click `List-Unsubscribe-Post` header (the
 *    body is `List-Unsubscribe=One-Click`, which is ignored);
 *  - by the site's /unsubscribe page, after the reader confirms. It may send
 *    the token as `{ token }` in a JSON body instead.
 *
 * No sign-in: the token is the credential, and it can only turn emails off.
 * GET is refused so link prefetchers and scanners can't unsubscribe anyone.
 */
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  internalErrorResponse,
  createServiceClient,
  isValidUUID,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('email-unsubscribe')

async function readToken(req: Request): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get('token')
  if (fromQuery) return fromQuery

  if (!req.headers.get('content-type')?.includes('application/json')) return null
  try {
    const body = await req.json()
    return typeof body?.token === 'string' ? body.token : null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 405)
    }

    const token = await readToken(req)
    if (!token || !isValidUUID(token)) {
      return errorResponse("This unsubscribe link isn't valid.", 400)
    }

    const { data, error } = await createServiceClient()
      .from('email_preferences')
      .update({ season_recap_emails: false })
      .eq('unsubscribe_token', token)
      .select('user_id')
    if (error) throw error

    if (!data || data.length === 0) {
      return errorResponse("This unsubscribe link isn't valid.", 404)
    }

    log.info('Unsubscribed from season recap emails', { user_id: data[0].user_id })
    return jsonResponse({ unsubscribed: true })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
