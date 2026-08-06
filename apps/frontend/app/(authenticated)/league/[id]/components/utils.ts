// Re-export shared utilities for convenience
export { formatRuntime, getReleaseYear } from '@/utils/date'

/**
 * Format a countdown from now until a deadline (e.g., "2d 5h", "3h 42m", "Processing soon")
 */
export function formatTimeRemaining(deadline: string | null): string {
  if (!deadline) return 'Processing soon'

  const now = new Date()
  const end = new Date(deadline)
  const diff = end.getTime() - now.getTime()

  if (diff <= 0) return 'Processing soon'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

/**
 * Format a release date for short display (e.g., "Jan 15")
 */
export function formatReleaseDateShort(date: string | null): string {
  if (!date) return 'TBA'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Format a release date for full display (e.g., "January 15, 2026")
 */
export function formatReleaseDateFull(date: string | null): string {
  if (!date) return 'TBA'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Check if a date is within the next N days from now
 */
export function isWithinDays(date: string | null, days: number): boolean {
  if (!date) return false
  const releaseDate = new Date(date)
  const now = new Date()
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return releaseDate >= now && releaseDate <= futureDate
}

/**
 * Check if a movie is still eligible to bid or counterpick on: it must have a
 * known release date that has not yet passed. Mirrors the server-side release
 * guard (`isUpcomingMovie` in supabase/functions/_shared/utils.ts) so a stale
 * client-side movie list can't submit an already-released title.
 */
export function isMovieBiddable(releaseDate: string | null): boolean {
  if (!releaseDate) return false
  const today = new Date().toISOString().split('T')[0]
  return releaseDate >= today
}

/**
 * Check if a date is before end of current year
 */
export function isThisYear(date: string | null): boolean {
  if (!date) return false
  const releaseDate = new Date(date)
  const now = new Date()
  const endOfYear = new Date(now.getFullYear(), 11, 31)
  return releaseDate >= now && releaseDate <= endOfYear
}

/**
 * Get popularity badge info based on popularity score
 */
export function getPopularityBadge(popularity: number | null): { label: string; variant: 'solid' | 'outline' } | null {
  if (!popularity) return null
  if (popularity >= 100) return { label: 'Trending', variant: 'solid' }
  if (popularity >= 50) return { label: 'Popular', variant: 'outline' }
  return null
}

/**
 * Build className string conditionally
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Get the CSS class for a bid type's left-border color indicator
 */
export function getBidTypeClass(bidType: 'pickup' | 'counterpick' | undefined): string {
  if (bidType === 'pickup') return 'bid-card-pickup'
  if (bidType === 'counterpick') return 'bid-card-counterpick'
  return ''
}

/**
 * Get a TMDb poster image URL at the specified size.
 * Handles both full URLs (from API) and paths (from DB).
 *
 * @param posterUrl - Either a full URL or a path like "/abc123.jpg"
 * @param size - TMDb image size (w92, w154, w185, w342, w500, w780, original)
 */
export function getTmdbPosterUrl(posterUrl: string | null | undefined, size: string = 'w500'): string | null {
  if (!posterUrl) return null

  // If it's already a full URL, extract the path and rebuild with requested size
  if (posterUrl.startsWith('http')) {
    // Extract path from URLs like https://image.tmdb.org/t/p/w500/abc123.jpg
    const match = posterUrl.match(/\/t\/p\/\w+(\/.+)$/)
    if (match) {
      return `https://image.tmdb.org/t/p/${size}${match[1]}`
    }
    // If it doesn't match expected format, return as-is
    return posterUrl
  }

  // It's just a path, prepend the base URL
  return `https://image.tmdb.org/t/p/${size}${posterUrl}`
}
