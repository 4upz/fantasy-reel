import type { User } from '@supabase/supabase-js'

/**
 * Extract display name from user metadata with fallbacks.
 * Handles Discord (global_name), Google (full_name), and email users.
 */
export function getDisplayNameFromUser(user: User): string {
  return (
    user.user_metadata.display_name ||
    user.user_metadata.full_name ||
    user.user_metadata.name ||
    user.user_metadata.global_name ||
    user.user_metadata.custom_claims?.global_name ||
    user.email?.split('@')[0] ||
    'User'
  )
}

/**
 * Extract avatar URL from user metadata.
 * Discord/GitHub use 'avatar_url', Google uses 'picture'.
 */
export function getAvatarUrlFromUser(user: User): string | null {
  return user.user_metadata.avatar_url || user.user_metadata.picture || null
}
