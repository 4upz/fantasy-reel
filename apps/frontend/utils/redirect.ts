/**
 * Resolve a user-supplied `next` value to a same-origin path, or `fallback`.
 *
 * A prefix check alone is not enough: browsers and the URL parser treat `\`
 * as `/` and drop tabs/newlines, so `/\evil.com` or `/\t/evil.com` become the
 * protocol-relative `//evil.com`. Resolving against our own origin and
 * comparing origins catches every such form.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/')) return fallback

  const base = 'http://localhost'
  let url: URL
  try {
    url = new URL(next, base)
  } catch {
    return fallback
  }
  if (url.origin !== base) return fallback

  return `${url.pathname}${url.search}${url.hash}`
}
