import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'

const log = createLogger('merge-accounts')

interface MergeAccountsRequest {
  originalUserId: string
  duplicateUserId: string
  // Access token of the duplicate (OAuth) session, captured by the link-account
  // server action before it signs in as the original account. It is the proof
  // that the caller controls the account about to be deleted.
  duplicateAccessToken: string
  provider: 'discord' | 'google'
}

// The duplicate is created by the OAuth sign-in that sends the user to the
// link-account page, whose context cookie lives for 10 minutes. An older
// account is not a fresh duplicate and must never be merged away.
const MAX_DUPLICATE_AGE_MS = 60 * 60 * 1000

/**
 * Create admin client with service role for privileged operations
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
    // Authenticate user - they must be signed in as the original account
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult
    const { user } = authResult

    // Parse request body
    const { originalUserId, duplicateUserId, duplicateAccessToken, provider }: MergeAccountsRequest =
      await req.json()
    const providerName = provider === 'discord' ? 'Discord' : 'Google'

    // Validate required fields
    if (!originalUserId || !isValidUUID(originalUserId)) {
      return errorResponse('Valid originalUserId is required', 400)
    }

    if (!duplicateUserId || !isValidUUID(duplicateUserId)) {
      return errorResponse('Valid duplicateUserId is required', 400)
    }

    if (!provider || (provider !== 'discord' && provider !== 'google')) {
      return errorResponse('Valid provider is required (discord or google)', 400)
    }

    // Verify the authenticated user matches the original account
    if (user.id !== originalUserId) {
      return errorResponse('You must be signed in as the original account to merge', 403)
    }

    // Don't allow merging the same account
    if (originalUserId === duplicateUserId) {
      return errorResponse('Cannot merge an account with itself', 400)
    }

    if (!duplicateAccessToken || typeof duplicateAccessToken !== 'string') {
      return errorResponse('duplicateAccessToken is required', 400)
    }

    const supabaseAdmin = createAdminClient()

    // The caller must prove they are signed in as the duplicate too. Without
    // this, anyone could name another user's id and take their OAuth login.
    const { data: duplicateSession, error: duplicateSessionError } =
      await supabaseAdmin.auth.getUser(duplicateAccessToken)

    if (duplicateSessionError || duplicateSession?.user?.id !== duplicateUserId) {
      return errorResponse('Could not verify the account to link. Please sign in again.', 403)
    }

    // Step 1: Get the duplicate user's data to verify it exists and has Discord
    const { data: duplicateUserData, error: duplicateUserError } =
      await supabaseAdmin.auth.admin.getUserById(duplicateUserId)

    if (duplicateUserError || !duplicateUserData?.user) {
      console.error('Error fetching duplicate user:', duplicateUserError)
      return errorResponse('Duplicate account not found', 404)
    }

    const duplicateUser = duplicateUserData.user

    // The duplicate exists only because the same email signed in with OAuth.
    const callerEmail = user.email?.toLowerCase()
    if (!callerEmail || duplicateUser.email?.toLowerCase() !== callerEmail) {
      return errorResponse('Accounts can only be linked when their emails match', 403)
    }

    if (Date.now() - new Date(duplicateUser.created_at).getTime() > MAX_DUPLICATE_AGE_MS) {
      return errorResponse('This account is too old to link automatically', 403)
    }

    // Deleting a user cascades to the leagues it owns and its teams, so never
    // merge away an account that has joined or created anything.
    const [participants, ownedLeagues, ownedSeries] = await Promise.all([
      supabaseAdmin
        .from('league_participants')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', duplicateUserId),
      supabaseAdmin
        .from('leagues')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', duplicateUserId),
      supabaseAdmin
        .from('league_series')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', duplicateUserId),
    ])

    const membershipError = participants.error ?? ownedLeagues.error ?? ownedSeries.error
    if (membershipError) throw membershipError

    if ((participants.count ?? 0) + (ownedLeagues.count ?? 0) + (ownedSeries.count ?? 0) > 0) {
      return errorResponse('This account already belongs to a league and cannot be merged', 403)
    }

    // Verify the duplicate has the specified provider identity
    const hasProvider = duplicateUser.identities?.some((i) => i.provider === provider)
    if (!hasProvider) {
      return errorResponse(`No ${providerName} identity found on duplicate account`, 400)
    }

    // Step 2: Transfer the OAuth identity using the SQL function
    const { data: transferResult, error: transferError } = await supabaseAdmin.rpc(
      'transfer_identity',
      {
        from_user_id: duplicateUserId,
        to_user_id: originalUserId,
        provider_name: provider,
      }
    )

    if (transferError) {
      console.error('Error transferring identity:', transferError)
      return errorResponse(`Failed to transfer ${providerName} identity`, 500)
    }

    if (!transferResult) {
      return errorResponse(`Could not find ${providerName} identity to transfer`, 400)
    }

    // Step 3: Delete the duplicate user using the SQL function
    const { error: deleteError } = await supabaseAdmin.rpc('delete_duplicate_user', {
      duplicate_user_id: duplicateUserId,
    })

    if (deleteError) {
      console.error('Error deleting duplicate user:', deleteError)
      // Non-fatal - the identity was transferred, just couldn't clean up
    }

    // Step 4: Optionally update original user's avatar if they don't have one
    const { data: originalUserData } = await supabaseAdmin.auth.admin.getUserById(originalUserId)

    if (originalUserData?.user) {
      const originalUser = originalUserData.user

      // Get avatar from duplicate (Discord uses avatar_url, Google uses picture)
      const duplicateAvatar =
        duplicateUser.user_metadata?.avatar_url || duplicateUser.user_metadata?.picture

      // Sync OAuth avatar if original doesn't have one
      if (!originalUser.user_metadata?.avatar_url && duplicateAvatar) {
        await supabaseAdmin.auth.admin.updateUserById(originalUserId, {
          user_metadata: {
            ...originalUser.user_metadata,
            avatar_url: duplicateAvatar,
          },
        })

        // Also update the profile's avatar if null
        await supabaseAdmin
          .from('profiles')
          .update({ avatar_url: duplicateAvatar })
          .eq('user_id', originalUserId)
          .is('avatar_url', null)
      }
    }

    return jsonResponse({
      success: true,
      message: `Accounts merged successfully. ${providerName} is now linked to your account.`,
    })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})
