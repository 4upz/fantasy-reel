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

/**
 * Format a date as relative time (e.g., "2 hours ago", "in 3 days")
 */
export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / (1000 * 60))
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  const absMins = Math.abs(diffMins)
  const absHours = Math.abs(diffHours)
  const absDays = Math.abs(diffDays)

  const isFuture = diffMs > 0

  if (absMins < 1) {
    return 'just now'
  }
  if (absMins < 60) {
    return isFuture ? `in ${absMins} minute${absMins === 1 ? '' : 's'}` : `${absMins} minute${absMins === 1 ? '' : 's'} ago`
  }
  if (absHours < 24) {
    return isFuture ? `in ${absHours} hour${absHours === 1 ? '' : 's'}` : `${absHours} hour${absHours === 1 ? '' : 's'} ago`
  }
  if (absDays < 7) {
    return isFuture ? `in ${absDays} day${absDays === 1 ? '' : 's'}` : `${absDays} day${absDays === 1 ? '' : 's'} ago`
  }

  return formatDate(dateString)
}
