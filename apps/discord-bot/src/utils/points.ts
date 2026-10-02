/**
 * A movie can be scored before it opens, but its points only count toward the
 * team total from release day -- today or earlier on the UTC calendar, the
 * same rule the server applies. Until then it is a pre-release score, and it
 * must read as not counted yet.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Released on or before today's UTC date. A missing or malformed date has not released. */
export function hasReleased(releaseDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!releaseDate || !DATE_ONLY.test(releaseDate)) return false
  return releaseDate <= now.toISOString().slice(0, 10)
}

/** A roster line's points: "24 pts" once they count, "24 pts at release" before, "Unreleased" with no score. */
export function formatRosterPoints(
  points: number | null,
  releaseDate: string | null,
  now: Date = new Date()
): string {
  if (points == null) return 'Unreleased'
  return hasReleased(releaseDate, now) ? `${points} pts` : `${points} pts at release`
}
