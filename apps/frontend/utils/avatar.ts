const STORAGE_AVATAR_PATH = /^\/storage\/v1\/object\/public\/(?:avatars|team-avatars)\/[^?#]+$/
const GOOGLE_AVATAR_HOST = /^lh\d+\.googleusercontent\.com$/
const PROJECT_REF = /^[a-z0-9]+$/

/**
 * The project ref from a legacy JWT anon key (its payload carries `ref`).
 * Null for publishable keys and anything unparseable.
 */
export function projectRefFromAnonKey(anonKey: string | undefined): string | null {
  try {
    const payload = anonKey?.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.ref === 'string' && PROJECT_REF.test(json.ref) ? json.ref : null
  } catch {
    return null
  }
}

/**
 * Whether an avatar URL points somewhere we trust to serve images: this
 * project's own avatar buckets, or the Discord and Google sign-in photo CDNs.
 *
 * Avatars render with `unoptimized`, so every viewer's browser fetches the URL
 * directly. Any other host would learn the IP address of everyone who views
 * the avatar. Mirrors `is_allowed_avatar_url()` in the database, which allows
 * any *.supabase.co storage host; this side pins storage to this deployment's
 * own origin (which may be a custom domain) and its `<ref>.supabase.co` host,
 * where avatars uploaded before a custom domain was set up still live.
 */
export function isAllowedAvatarUrl(
  avatarUrl: string,
  supabaseUrl: string | undefined,
  projectRef: string | null = null,
): boolean {
  try {
    const url = new URL(avatarUrl)
    if (url.username || url.password) return false

    const isOwnStorage =
      (supabaseUrl && url.origin === new URL(supabaseUrl).origin) ||
      (projectRef && url.origin === `https://${projectRef}.supabase.co`)
    if (isOwnStorage) return STORAGE_AVATAR_PATH.test(url.pathname)

    if (url.protocol !== 'https:' || url.port) return false
    return url.hostname === 'cdn.discordapp.com' || GOOGLE_AVATAR_HOST.test(url.hostname)
  } catch {
    return false
  }
}

const OWN_PROJECT_REF = projectRefFromAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

/** The avatar URL if it is safe to render, otherwise null (callers show initials). */
export function safeAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null
  return isAllowedAvatarUrl(avatarUrl, process.env.NEXT_PUBLIC_SUPABASE_URL, OWN_PROJECT_REF)
    ? avatarUrl
    : null
}
