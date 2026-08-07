import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('get-leagues')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { supabase } = authResult

    // Get leagues for the user (RLS will handle filtering)
    const { data: leagues, error: fetchError } = await supabase
      .from('leagues')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching leagues:', fetchError)
      return errorResponse('Failed to fetch leagues', 500)
    }

    return jsonResponse({ leagues })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})