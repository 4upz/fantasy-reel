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
