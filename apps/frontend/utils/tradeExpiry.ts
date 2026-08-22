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
  noReleaseDate: 'No movie in this trade is still unreleased',
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
  /**
   * Wait for a movie to open. `movieId` is null until the proposer picks one,
   * meaning "the soonest" -- the server resolves that default so the two sides
   * cannot disagree about which movie it is.
   */
  | { kind: 'release'; movieId: string | null }
  /** Raw `datetime-local` value: local wall time, no zone. */
  | { kind: 'custom'; value: string }

export interface ResolvedExpiry {
  expires_at: string | null
  expiry_anchor: ExpiryAnchor | null
  expiry_anchor_movie_id: string | null
}

export type ExpiryResolution =
  | { ok: true; expiry: ResolvedExpiry }
  | { ok: false; error: string }

const MS_PER_MINUTE = 60_000

/** A movie as the picker needs it -- both sides of the offer, title and date. */
export interface ExpiryMovie {
  movie_id: string
  title: string
  release_date: string | null
}

/** A movie the offer could wait on: still unreleased, with a known date. */
export interface AnchorCandidate {
  movieId: string
  title: string
  releaseDate: string
  /** When it stops counting as upcoming: start of the day after release, UTC. */
  boundary: string
}

export interface ReleaseAnchor {
  /** Whether "when X releases" applies to the current movie selection. */
  available: boolean
  /** Why not, phrased for the reader. Present only when unavailable. */
  reason?: string
  /**
   * Every unreleased movie in the offer, soonest first. More than one means the
   * proposer gets to choose which release the deal hinges on.
   */
  candidates: AnchorCandidate[]
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
 * The movies in an offer its expiry could wait on: still unreleased, soonest
 * first.
 *
 * Every unreleased movie qualifies, not just the earliest. A trade often
 * bundles one film that is nearly out with another months away, and which of
 * them the deal really hinges on is the proposer's call. A single already-out
 * movie no longer disqualifies the whole option.
 *
 * This mirrors offer_anchor_candidates() in SQL, which is the authority -- this
 * copy exists so the picker can label and order the chip without a round trip
 * per keystroke.
 */
export function resolveReleaseAnchor(movies: ExpiryMovie[], now = Date.now()): ReleaseAnchor {
  if (movies.length === 0) {
    return { available: false, reason: 'Add a movie to use this', candidates: [] }
  }

  const candidates = movies
    .filter((movie): movie is ExpiryMovie & { release_date: string } => Boolean(movie.release_date))
    .map((movie) => ({
      movieId: movie.movie_id,
      title: movie.title,
      releaseDate: movie.release_date,
      boundary: releaseBoundary(movie.release_date),
    }))
    .filter(
      (candidate): candidate is AnchorCandidate & { boundary: Date } =>
        candidate.boundary !== null && candidate.boundary.getTime() > now
    )
    .sort((a, b) => a.boundary.getTime() - b.boundary.getTime())
    .map((candidate) => ({ ...candidate, boundary: candidate.boundary.toISOString() }))

  if (candidates.length === 0) {
    return { available: false, reason: 'Nothing in this trade is still unreleased', candidates: [] }
  }

  // The soonest release could be minutes away. Deliberately not bumped up to
  // the minimum -- the chip would then be lying about what it does -- but the
  // later candidates are still perfectly good choices, so the option stays open.
  const usable = candidates.filter(
    (candidate) =>
      new Date(candidate.boundary).getTime() >= now + MIN_EXPIRY_MINUTES * MS_PER_MINUTE
  )

  if (usable.length === 0) {
    return {
      available: false,
      reason: `${candidates[0].title} is out too soon`,
      candidates: [],
    }
  }

  return { available: true, candidates: usable }
}

/** The candidate an offer is anchored to, or the default when none was picked. */
export function anchorFor(
  anchor: ReleaseAnchor,
  movieId: string | null
): AnchorCandidate | undefined {
  if (!movieId) return anchor.candidates[0]
  return anchor.candidates.find((candidate) => candidate.movieId === movieId)
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
      return {
        ok: true,
        expiry: { expires_at: null, expiry_anchor: null, expiry_anchor_movie_id: null },
      }

    case 'preset':
      return {
        ok: true,
        expiry: {
          expires_at: new Date(now + choice.hours * 60 * MS_PER_MINUTE).toISOString(),
          expiry_anchor: 'fixed',
          expiry_anchor_movie_id: null,
        },
      }

    case 'release': {
      if (!releaseAnchor.available) {
        return { ok: false, error: releaseAnchor.reason ?? EXPIRY_ERRORS.noReleaseDate }
      }

      const chosen = anchorFor(releaseAnchor, choice.movieId)
      if (!chosen) {
        // The picked movie left the offer while the modal was open.
        return { ok: false, error: EXPIRY_ERRORS.noReleaseDate }
      }

      // The timestamp is a preview; the server re-derives it from the chosen
      // movie's live release date, which may have moved since this page loaded.
      return {
        ok: true,
        expiry: {
          expires_at: chosen.boundary,
          expiry_anchor: 'movie_release',
          expiry_anchor_movie_id: chosen.movieId,
        },
      }
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
      return {
        ok: true,
        expiry: {
          expires_at: picked.toISOString(),
          expiry_anchor: 'fixed',
          expiry_anchor_movie_id: null,
        },
      }
    }
  }
}

/** A bare release date for the anchor menu, e.g. "Sep 18, 2026". */
export function formatReleaseDate(releaseDate: string): string {
  const [year, month, day] = releaseDate.split('-').map(Number)
  if (!year || !month || !day) return releaseDate
  // Built as a local date on purpose: `new Date('2026-09-18')` is UTC midnight,
  // which renders as the 17th for everyone west of UTC.
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
