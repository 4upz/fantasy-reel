/**
 * The US release date of a movie, from TMDb's per-country release dates.
 *
 * TMDb's top-level `release_date` is the movie's *primary* release: its first
 * theatrical opening anywhere. Hollywood films routinely open abroad on a
 * Wednesday before the US Friday, and some open abroad weeks or months
 * earlier, so that date made movies count as released (points, release-day
 * posts, bid locks) before anyone in the US could see them. The game runs on
 * the US calendar, so every `movies.release_date` comes from here.
 */

export interface TMDbReleaseDate {
  type: number
  release_date: string
  certification: string
  note?: string
}

/** The `/movie/{id}/release_dates` payload (or `append_to_response=release_dates`). */
export interface TMDbReleaseDates {
  results: Array<{ iso_3166_1: string; release_dates: TMDbReleaseDate[] }>
}

/** TMDb release types. Premieres (1, festivals) and physical/TV (5, 6) never count. */
export const RELEASE_TYPE = { limited: 2, wide: 3, digital: 4 } as const

/**
 * How much earlier a limited release must open than the wide one to count as
 * the release. A platform release (NY/LA, expanding weeks later) opens well
 * before its wide date; IMAX early-access and fan-event screenings land a few
 * days before it, and are not when the movie came out.
 */
export const PLATFORM_RELEASE_LEAD_DAYS = 7

export function usReleases(releaseDates: TMDbReleaseDates | undefined | null): TMDbReleaseDate[] {
  return releaseDates?.results?.find((r) => r.iso_3166_1 === 'US')?.release_dates ?? []
}

/** Earliest US date (YYYY-MM-DD) of one release type, or null. */
export function earliestUsDate(releaseDates: TMDbReleaseDates | undefined | null, type: number): string | null {
  const dates = usReleases(releaseDates)
    .filter((r) => r.type === type && /^\d{4}-\d{2}-\d{2}/.test(r.release_date ?? ''))
    .map((r) => r.release_date.slice(0, 10))
    .sort()
  return dates[0] ?? null
}

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 86_400_000
}

/**
 * The date a movie opened (or opens) in the US:
 *
 * 1. The wide theatrical date, unless a limited release opened at least
 *    PLATFORM_RELEASE_LEAD_DAYS earlier -- then that limited date.
 * 2. A limited-only theatrical release.
 * 3. A US digital/streaming premiere, for movies with no US theatrical run.
 * 4. `fallback` (TMDb's primary date) when TMDb lists no US release yet, so a
 *    movie without US distribution stays as draftable as it was before.
 */
export function usReleaseDate(
  releaseDates: TMDbReleaseDates | undefined | null,
  fallback: string | null | undefined,
): string | null {
  const wide = earliestUsDate(releaseDates, RELEASE_TYPE.wide)
  const limited = earliestUsDate(releaseDates, RELEASE_TYPE.limited)
  if (wide && limited && daysBetween(limited, wide) >= PLATFORM_RELEASE_LEAD_DAYS) return limited
  return wide ?? limited ?? earliestUsDate(releaseDates, RELEASE_TYPE.digital) ?? (fallback || null)
}
