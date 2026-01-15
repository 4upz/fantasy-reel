import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  authenticateRequest,
  isAuthError,
} from '../_shared/utils.ts'

interface MergeAccountsRequest {
  originalUserId: string
  duplicateUserId: string
}

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
    const { originalUserId, duplicateUserId }: MergeAccountsRequest = await req.json()

    // Validate required fields
    if (!originalUserId || !isValidUUID(originalUserId)) {
      return errorResponse('Valid originalUserId is required', 400)
    }

    if (!duplicateUserId || !isValidUUID(duplicateUserId)) {
      return errorResponse('Valid duplicateUserId is required', 400)
    }

    // Verify the authenticated user matches the original account
    if (user.id !== originalUserId) {
      return errorResponse('You must be signed in as the original account to merge', 403)
    }

    // Don't allow merging the same account
    if (originalUserId === duplicateUserId) {
      return errorResponse('Cannot merge an account with itself', 400)
    }

    const supabaseAdmin = createAdminClient()

    // Step 1: Get the duplicate user's data to verify it exists and has Discord
    const { data: duplicateUserData, error: duplicateUserError } =
      await supabaseAdmin.auth.admin.getUserById(duplicateUserId)

    if (duplicateUserError || !duplicateUserData?.user) {
      console.error('Error fetching duplicate user:', duplicateUserError)
      return errorResponse('Duplicate account not found', 404)
    }

    const duplicateUser = duplicateUserData.user

    // Verify the duplicate has a Discord identity
    const hasDiscord = duplicateUser.identities?.some((i) => i.provider === 'discord')
    if (!hasDiscord) {
      return errorResponse('No Discord identity found on duplicate account', 400)
    }

    // Step 2: Transfer the Discord identity using the SQL function
    const { data: transferResult, error: transferError } = await supabaseAdmin.rpc(
      'transfer_identity',
      {
        from_user_id: duplicateUserId,
        to_user_id: originalUserId,
        provider_name: 'discord',
      }
    )

    if (transferError) {
      console.error('Error transferring identity:', transferError)
      return errorResponse('Failed to transfer Discord identity', 500)
    }

    if (!transferResult) {
      return errorResponse('Could not find Discord identity to transfer', 400)
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

      // Sync Discord avatar if original doesn't have one
      if (!originalUser.user_metadata?.avatar_url && duplicateUser.user_metadata?.avatar_url) {
        await supabaseAdmin.auth.admin.updateUserById(originalUserId, {
          user_metadata: {
            ...originalUser.user_metadata,
            avatar_url: duplicateUser.user_metadata.avatar_url,
          },
        })

        // Also update the profile's avatar if null
        await supabaseAdmin
          .from('profiles')
          .update({ avatar_url: duplicateUser.user_metadata.avatar_url })
          .eq('user_id', originalUserId)
          .is('avatar_url', null)
      }
    }

    return jsonResponse({
      success: true,
      message: 'Accounts merged successfully. Discord is now linked to your account.',
    })
  } catch (error) {
    console.error('Unexpected error in merge-accounts:', error)
    return errorResponse('Internal server error', 500)
  }
})
