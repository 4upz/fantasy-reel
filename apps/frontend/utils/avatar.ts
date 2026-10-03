const STORAGE_AVATAR_PATH = /^\/storage\/v1\/object\/public\/(?:avatars|team-avatars)\/[^?#]+$/
const GOOGLE_AVATAR_HOST = /^lh\d+\.googleusercontent\.com$/

/**
 * Whether an avatar URL points somewhere we trust to serve images: this
 * project's own avatar buckets, or the Discord and Google sign-in photo CDNs.
 *
 * Avatars render with `unoptimized`, so every viewer's browser fetches the URL
 * directly. Any other host would learn the IP address of everyone who views
 * the avatar. Mirrors `is_allowed_avatar_url()` in the database, which pins
 * storage to a *.supabase.co host; this side pins it to this deployment's own.
 */
export function isAllowedAvatarUrl(avatarUrl: string, supabaseUrl: string | undefined): boolean {
  try {
    const url = new URL(avatarUrl)
    if (url.username || url.password) return false

    if (supabaseUrl && url.origin === new URL(supabaseUrl).origin) {
      return STORAGE_AVATAR_PATH.test(url.pathname)
    }

    if (url.protocol !== 'https:' || url.port) return false
    return url.hostname === 'cdn.discordapp.com' || GOOGLE_AVATAR_HOST.test(url.hostname)
  } catch {
    return false
  }
}

/** The avatar URL if it is safe to render, otherwise null (callers show initials). */
export function safeAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null
  return isAllowedAvatarUrl(avatarUrl, process.env.NEXT_PUBLIC_SUPABASE_URL) ? avatarUrl : null
}
