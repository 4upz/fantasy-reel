// Re-export shared utilities for convenience
export { formatRuntime, getReleaseYear } from '@/utils/date'

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
