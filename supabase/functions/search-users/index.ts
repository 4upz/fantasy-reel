import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, authenticateRequest, isAuthError, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('search-users')

interface SearchUsersRequest {
  query: string
  league_id: string
  limit?: number
}

interface UserSearchResult {
  user_id: string
  display_name: string
  email_hint: string
  avatar_url: string | null
}

/**
 * Truncate email for privacy (e.g., "john@example.com" -> "j***@example.com")
 */
function truncateEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const maskedLocal = local[0] + '***'
  return `${maskedLocal}@${domain}`
}

/**
 * Create admin client for accessing auth.users
 */
function createAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate user
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user, supabase: supabaseClient } = authResult

    // Parse request body
    const { query, league_id, limit = 10 }: SearchUsersRequest = await req.json()

    // Validate required fields
    if (!league_id || !isValidUUID(league_id)) {
      return errorResponse('Valid league_id is required', 400)
    }

    if (!query || query.trim().length < 2) {
      return errorResponse('Search query must be at least 2 characters', 400)
    }

    const searchQuery = query.trim()
    const resultLimit = Math.min(Math.max(1, limit), 20) // Clamp between 1-20

    // Verify user is the league owner
    const { data: league, error: leagueError } = await supabaseClient
      .from('leagues')
      .select('owner_id')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can search for users to invite', 403)
    }

    // Fetch participants and pending invites in parallel
    const [participantsResult, pendingInvitesResult] = await Promise.all([
      supabaseClient
        .from('league_participants')
        .select('user_id')
        .eq('league_id', league_id)
        .eq('status', 'active'),
      supabaseClient
        .from('invitations')
        .select('email')
        .eq('league_id', league_id)
        .eq('status', 'pending'),
    ])

    const participantUserIds = participantsResult.data?.map(p => p.user_id) ?? []
    const pendingInviteEmails = new Set(
      pendingInvitesResult.data?.map(i => i.email.toLowerCase()) ?? []
    )

    const supabaseAdmin = createAdminClient()
    const excludeIds = [user.id, ...participantUserIds]

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .ilike('display_name', `%${searchQuery}%`)
      .not('user_id', 'in', `(${excludeIds.map(id => `"${id}"`).join(',')})`)
      .limit(resultLimit + 10) // Fetch extra to account for filtering

    if (profilesError) {
      console.error('Error searching profiles:', profilesError)
      return errorResponse('Failed to search users', 500)
    }

    if (!profiles || profiles.length === 0) {
      return jsonResponse({ users: [] })
    }

    // Get emails for these users from auth.users
    const userIds = profiles.map(p => p.user_id)
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 100
    })

    if (authError) {
      console.error('Error fetching auth users:', authError)
      return errorResponse('Failed to search users', 500)
    }

    // Create a map of user_id to email
    const userEmailMap = new Map<string, string>()
    authUsers.users.forEach(u => {
      if (userIds.includes(u.id) && u.email) {
        userEmailMap.set(u.id, u.email)
      }
    })

    // Build results, excluding users with pending invitations
    const results: UserSearchResult[] = []

    for (const profile of profiles) {
      if (results.length >= resultLimit) break

      const email = userEmailMap.get(profile.user_id)
      if (!email) continue

      // Exclude users who already have pending invitations
      if (pendingInviteEmails.has(email.toLowerCase())) continue

      results.push({
        user_id: profile.user_id,
        display_name: profile.display_name || 'Unknown User',
        email_hint: truncateEmail(email),
        avatar_url: profile.avatar_url
      })
    }

    return jsonResponse({ users: results })

  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
