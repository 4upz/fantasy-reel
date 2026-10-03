// Pure helpers for search-users, kept here so they can be unit tested.

/**
 * Mask an email for display, keeping only enough to tell two same-named users
 * apart: "john@example.com" -> "j***@e***.com". The domain is masked too, so
 * search results don't reveal where someone has their account.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const dot = domain.lastIndexOf('.')
  const maskedDomain = dot > 0 ? `${domain[0]}***${domain.slice(dot)}` : `${domain[0]}***`
  return `${local[0]}***@${maskedDomain}`
}

/**
 * Escape ILIKE wildcards so the query matches literally: otherwise "__"
 * matches every display name and turns the search into a directory listing.
 * PostgREST also rewrites `*` to `%` in like filters, so `*` is escaped too
 * (it then matches a literal `%`, never everything).
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_*]/g, (c) => `\\${c}`)
}
