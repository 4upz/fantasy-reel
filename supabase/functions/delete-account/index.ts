/**
 * Delete Account Edge Function
 *
 * Deletes the caller's own account. The database does the real work in the
 * same transaction as the auth delete (handle_auth_user_deletion, a trigger on
 * auth.users): owned seasons pass to another member, teams in active and
 * completed seasons stay as a "Former member", and the person's email and name
 * are scrubbed. This function guards the request and removes uploaded photos,
 * which live in Storage rather than the database.
 *
 * Guards: a typed confirmation, and a sign-in within the last 15 minutes, so a
 * session left open on a shared computer cannot delete the account.
 *
 * The iPhone app also sends a fresh Sign in with Apple authorization code for
 * accounts that use Apple; once the account is gone the code is used to revoke
 * the app's Apple access (App Review 5.1.1(v), _shared/apple-revocation.ts).
 */
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  authenticateRequest,
  isAuthError,
  createServiceClient,
  internalErrorResponse,
} from '../_shared/utils.ts'
import { createLogger, serializeError } from '../_shared/logger.ts'
import { signedInRecently } from '../_shared/recent-auth.ts'
import { appleRevocationConfig, revokeAppleAuthorization } from '../_shared/apple-revocation.ts'

const log = createLogger('delete-account')

const DELETE_CONFIRMATION = 'DELETE'

interface DeleteAccountRequest {
  confirmation?: string
  /** From a Sign in with Apple authorization made just before deleting (iPhone app). */
  apple_authorization_code?: unknown
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    const authResult = await authenticateRequest(req)
    if (isAuthError(authResult)) return authResult

    const { user } = authResult
    const { confirmation, apple_authorization_code }: DeleteAccountRequest = await req.json().catch(() => ({}))

    if (confirmation !== DELETE_CONFIRMATION) {
      return errorResponse(`Type ${DELETE_CONFIRMATION} to confirm`, 400)
    }

    if (!signedInRecently(req.headers.get('Authorization'))) {
      return errorResponse('Sign in again to delete your account', 403, { code: 'reauth_required' })
    }

    const serviceClient = createServiceClient()

    const blocked = await liveDraftBlockers(serviceClient, user.id)
    if (blocked) return blocked

    // Collected before the delete: setup-season teams go with it.
    const { data: teams, error: teamsError } = await serviceClient
      .from('teams')
      .select('id, league_participants!inner(user_id)')
      .eq('league_participants.user_id', user.id)
    if (teamsError) throw teamsError

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id)
    if (deleteError) {
      // A draft may have started since the check above; the trigger refuses
      // then, and GoTrue reports it only as a generic database error.
      const raced = await liveDraftBlockers(serviceClient, user.id)
      if (raced) return raced
      throw deleteError
    }

    log.info('Account deleted', { user_id: user.id })

    await removeUploadedPhotos(serviceClient, user.id, (teams ?? []).map((t: { id: string }) => t.id))
    await revokeApple(user.id, apple_authorization_code)

    return jsonResponse({ deleted: true })
  } catch (error) {
    return internalErrorResponse(error, log)
  }
})

async function liveDraftBlockers(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<Response | null> {
  const { data, error } = await serviceClient.rpc('account_deletion_blockers', { p_user_id: userId })
  if (error) throw error
  const names = (data ?? []).map((row: { league_name: string }) => row.league_name)
  if (names.length === 0) return null
  return errorResponse(
    `Finish the draft in ${names.join(', ')} before deleting your account`,
    409,
    { code: 'live_draft', leagues: names }
  )
}

/**
 * Best effort, after the delete: revoking first would sign the person out of
 * Apple on their phone even if the delete were then refused (a draft starting
 * in between). A failure is logged; the account is gone either way.
 */
async function revokeApple(userId: string, code: unknown): Promise<void> {
  if (typeof code !== 'string' || code.length === 0 || code.length > 1024) return
  const config = appleRevocationConfig()
  if (!config) {
    log.warn('Apple authorization not revoked: Apple secrets are not configured', { user_id: userId })
    return
  }
  const result = await revokeAppleAuthorization(code, config)
  if (result === 'revoked') {
    log.info('Apple authorization revoked', { user_id: userId })
  } else {
    log.error('Apple authorization revoke failed', { user_id: userId })
  }
}

/**
 * Best effort: the account is already gone, and the database no longer points
 * at these files, so a failure here is logged rather than reported.
 */
async function removeUploadedPhotos(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  teamIds: string[]
): Promise<void> {
  const folders: Array<[bucket: string, folder: string]> = [
    ['avatars', userId],
    ...teamIds.map((id): [string, string] => ['team-avatars', id]),
  ]

  for (const [bucket, folder] of folders) {
    try {
      const { data: files, error: listError } = await serviceClient.storage.from(bucket).list(folder)
      if (listError) throw listError
      if (!files || files.length === 0) continue
      const { error: removeError } = await serviceClient.storage
        .from(bucket)
        .remove(files.map((file: { name: string }) => `${folder}/${file.name}`))
      if (removeError) throw removeError
    } catch (error) {
      log.error('Failed to remove uploaded photos', { user_id: userId, bucket, folder, error: serializeError(error) })
    }
  }
}
