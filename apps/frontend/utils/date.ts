/**
 * Format a date string for display
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Calculate the number of days until a date
 */
export function getDaysUntil(dateString: string): number {
  const now = new Date()
  const target = new Date(dateString)
  const diffTime = target.getTime() - now.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Check if a date has passed (is expired)
 */
export function isExpired(dateString: string): boolean {
  return new Date(dateString) < new Date()
}

/**
 * Get the year from a release date string
 */
export function getReleaseYear(date: string | null): number | null {
  if (!date) return null
  return new Date(date).getFullYear()
}

/**
 * Format runtime in hours and minutes (e.g., "2h 15m")
 */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}
