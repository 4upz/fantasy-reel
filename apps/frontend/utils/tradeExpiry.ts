import type { ExpiredReason, ExpiryAnchor } from '@/types'

/**
 * Offer expiry: how long an unanswered trade offer stands before it lapses.
 *
 * Distinct from the two clocks that already existed -- a league's season-level
 * trade deadline, and the post-accept commissioner review window. Call this one
 * "expires"/"offer window" in copy, never "deadline".
 *
 * Everything here is a UI convenience. The server resolves and range-checks the
 * expiry again in `supabase/functions/_shared/trade-expiry.ts`, because a
 * crafted request skips this file entirely.
 */

/** Kept in step with MIN_EXPIRY_MINUTES / MAX_EXPIRY_DAYS on the server. */
export const MIN_EXPIRY_MINUTES = 60
export const MAX_EXPIRY_DAYS = 14

/**
 * Mirror of EXPIRY_ERRORS in the shared Edge Function module, so the message
 * under the picker and the server's 400 never contradict each other. Change
 * both together.
 */
export const EXPIRY_ERRORS = {
  tooSoon: `An offer has to stay open at least ${MIN_EXPIRY_MINUTES / 60} hour`,
  tooLate: `An offer cannot stay open longer than ${MAX_EXPIRY_DAYS} days`,
  unparseable: 'Offer expiry is not a valid date',
  noReleaseDate: 'No movie in this trade has a release date to expire on',
  alreadyReleased: 'The first movie in this trade is already released',
} as const

export const DEFAULT_EXPIRY_HOURS = 48

export const EXPIRY_PRESETS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
]

export type ExpiryChoice =
  | { kind: 'none' }
  | { kind: 'preset'; hours: number }
  | { kind: 'release' }
  /** Raw `datetime-local` value: local wall time, no zone. */
  | { kind: 'custom'; value: string }

export interface ResolvedExpiry {
  expires_at: string | null
  expiry_anchor: ExpiryAnchor | null
}

export type ExpiryResolution =
  | { ok: true; expiry: ResolvedExpiry }
  | { ok: false; error: string }

const MS_PER_MINUTE = 60_000

/** A movie as the picker needs it -- both sides of the offer, title and date. */
export interface ExpiryMovie {
  title: string
  release_date: string | null
}

export interface ReleaseAnchor {
  /** Whether "when X releases" can be chosen for the current movie selection. */
  available: boolean
  /** Why not, phrased for the reader. Present only when unavailable. */
  reason?: string
  /** The earliest-releasing movie -- the one the chip is named after. */
  title?: string
  expiresAt?: string
}

/**
 * The instant a movie stops counting as upcoming.
 *
 * Matches isUpcomingMovie() on the server, which treats a movie as upcoming
 * while release_date >= today (UTC) -- so it flips at the start of the day
 * AFTER its release date. Same boundary as resolve_first_release_expiry() in
 * SQL, which is what actually decides.
 */
function releaseBoundary(releaseDate: string): Date | null {
  const [year, month, day] = releaseDate.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day + 1))
}

/**
 * The movie an offer's release anchor points at: the one that opens first.
 *
 * The single definition of "which movie" for the whole frontend -- the picker
 * names it on the chip and the card names it on an expired offer, and if those
 * two disagreed the app would promise "when Dune 3 releases" and then blame a
 * different film for the expiry, with nothing failing to signal it.
 */
export function earliestReleasingMovie<T extends ExpiryMovie>(movies: T[]): T | null {
  const dated = movies.filter((movie) => movie.release_date)
  if (dated.length === 0) return null

  // Compared as boundary instants rather than raw date strings so this cannot
  // drift from the rule resolveReleaseAnchor applies.
  return dated.reduce((first, movie) => {
    const a = releaseBoundary(movie.release_date as string)
    const b = releaseBoundary(first.release_date as string)
    if (!a) return first
    if (!b) return movie
    return a < b ? movie : first
  })
}

/**
 * Work out whether the release chip applies to the movies currently selected,
 * and what it would mean.
 *
 * Every unavailable case gets a reason rather than a silently greyed chip. Note
 * that an already-released movie is a normal case, not an error -- rosters hold
 * released movies and trading them is legal; the option just doesn't apply.
 */
export function resolveReleaseAnchor(movies: ExpiryMovie[], now = Date.now()): ReleaseAnchor {
  if (movies.length === 0) {
    return { available: false, reason: 'Add a movie to use this' }
  }

  const first = earliestReleasingMovie(movies)
  const boundary = first?.release_date ? releaseBoundary(first.release_date) : null

  if (!first || !boundary) {
    return { available: false, reason: 'No release date yet' }
  }

  const earliest = { title: first.title, boundary }

  if (earliest.boundary.getTime() <= now) {
    return { available: false, reason: `${earliest.title} is already out`, title: earliest.title }
  }

  if (earliest.boundary.getTime() < now + MIN_EXPIRY_MINUTES * MS_PER_MINUTE) {
    // Deliberately not bumped up to the minimum: the chip would then be lying
    // about what it does.
    return {
      available: false,
      reason: `${earliest.title} is out too soon`,
      title: earliest.title,
    }
  }

  return {
    available: true,
    title: earliest.title,
    expiresAt: earliest.boundary.toISOString(),
  }
}

/**
 * Turn the picker's state into what gets sent, or the message to show under it.
 *
 * The league's own trade deadline is NOT clamped here -- the server does that,
 * since only it knows the deadline. A clamped offer simply comes back with an
 * earlier `expires_at` than the preview showed.
 */
export function resolveExpiryChoice(
  choice: ExpiryChoice,
  releaseAnchor: ReleaseAnchor,
  now = Date.now()
): ExpiryResolution {
  switch (choice.kind) {
    case 'none':
      return { ok: true, expiry: { expires_at: null, expiry_anchor: null } }

    case 'preset':
      return {
        ok: true,
        expiry: {
          expires_at: new Date(now + choice.hours * 60 * MS_PER_MINUTE).toISOString(),
          expiry_anchor: 'fixed',
        },
      }

    case 'release':
      if (!releaseAnchor.available || !releaseAnchor.expiresAt) {
        return { ok: false, error: releaseAnchor.reason ?? EXPIRY_ERRORS.noReleaseDate }
      }
      // The timestamp is a preview; the server re-derives it from live release
      // dates, which may have moved since this page loaded.
      return {
        ok: true,
        expiry: { expires_at: releaseAnchor.expiresAt, expiry_anchor: 'first_release' },
      }

    case 'custom': {
      if (!choice.value) return { ok: false, error: EXPIRY_ERRORS.unparseable }

      const picked = new Date(choice.value)
      if (Number.isNaN(picked.getTime())) return { ok: false, error: EXPIRY_ERRORS.unparseable }

      // Re-checked on every render, not just on change: the clock keeps moving
      // while the modal is open, so a 6:00 pick made at 5:00 is invalid by 5:01.
      if (picked.getTime() < now + MIN_EXPIRY_MINUTES * MS_PER_MINUTE) {
        return { ok: false, error: EXPIRY_ERRORS.tooSoon }
      }
      if (picked.getTime() > now + MAX_EXPIRY_DAYS * 24 * 60 * MS_PER_MINUTE) {
        return { ok: false, error: EXPIRY_ERRORS.tooLate }
      }

      picked.setSeconds(0, 0)
      return { ok: true, expiry: { expires_at: picked.toISOString(), expiry_anchor: 'fixed' } }
    }
  }
}

/** `datetime-local` wants local wall time in `YYYY-MM-DDTHH:mm`, not an ISO instant. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/**
 * The resolved expiry spelled out, e.g. "Fri, Aug 22 at 4:15 PM".
 *
 * Always shown alongside the chips: `datetime-local` gives no timezone
 * affordance, and the release and preset options would otherwise be the user
 * doing date math in their head.
 */
export function formatExpiryAbsolute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export type ExpiryUrgency = 'relaxed' | 'soon' | 'urgent' | 'lapsed'

/** How loudly the countdown should read. Tiers match the card's pill styling. */
export function expiryUrgency(iso: string, now = Date.now()): ExpiryUrgency {
  const remaining = new Date(iso).getTime() - now
  if (remaining <= 0) return 'lapsed'
  if (remaining < 2 * 60 * 60 * 1000) return 'urgent'
  if (remaining < 24 * 60 * 60 * 1000) return 'soon'
  return 'relaxed'
}

/**
 * Why an expired offer expired.
 *
 * Returns null for offers that expired some other way -- a competing trade
 * executed, or the offer stopped validating -- whose explanation already lives
 * in `veto_reason`. Before this feature both cases rendered as a bare
 * "Expired", which is the papercut this fixes.
 */
export function expiredReasonCopy(
  reason: ExpiredReason | null | undefined,
  anchorMovieTitle?: string | null
): string | null {
  switch (reason) {
    case 'offer_window':
      return 'The offer window closed'
    case 'movie_released':
      return anchorMovieTitle ? `${anchorMovieTitle} released` : 'Its first movie released'
    case 'league_deadline':
      return 'The league trade deadline passed'
    default:
      return null
  }
}
