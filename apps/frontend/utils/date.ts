/** A bare calendar date, e.g. a movie's release_date, with no time attached. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a date for display.
 *
 * `new Date('2026-08-13')` is UTC midnight, which renders as the 12th for
 * everyone west of UTC - so every release date in the app read a day early.
 * A bare date has no timezone to convert between, so it is built as a local
 * date instead. Timestamps still parse normally.
 */
function parseForDisplay(dateString: string): Date {
  if (!DATE_ONLY.test(dateString)) return new Date(dateString)
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Format a date string for display
 */
export function formatDate(dateString: string): string {
  return parseForDisplay(dateString).toLocaleDateString('en-US', {
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
