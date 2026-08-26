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

/**
 * The app-wide window rules, used whenever a league has not set its own.
 * Kept in step with MIN_EXPIRY_MINUTES / MAX_EXPIRY_DAYS on the server.
 */
export const MIN_EXPIRY_MINUTES = 60
export const MAX_EXPIRY_DAYS = 14
export const DEFAULT_EXPIRY_HOURS = 48

/**
 * A league's offer-window rules. Every bound in here is per-league, so nothing
 * downstream may read the module constants directly -- they are only the
 * fallback, applied once in resolveExpiryBounds().
 *
 * Mirrors ExpiryBounds on the server; the two sides have to agree on the shape
 * or the picker starts offering windows the 400 then refuses.
 */
export interface ExpiryBounds {
  defaultHours: number
  minMinutes: number
  maxDays: number
}

/** What a league that has configured nothing gets. */
export const DEFAULT_EXPIRY_BOUNDS: ExpiryBounds = {
  defaultHours: DEFAULT_EXPIRY_HOURS,
  minMinutes: MIN_EXPIRY_MINUTES,
  maxDays: MAX_EXPIRY_DAYS,
}

/** Just the league columns this reads, all optional -- see resolveExpiryBounds. */
export interface ExpiryBoundsSource {
  trade_offer_expiry_default_hours?: number | null
  trade_offer_expiry_min_hours?: number | null
  trade_offer_expiry_max_days?: number | null
}

/**
 * Read a league's window rules off its row, falling back per field.
 *
 * The columns are optional as well as nullable on purpose: a client running
 * against a database that predates the migration gets `undefined` rather than
 * `null`, and that has to behave the same as an unconfigured league rather than
 * producing NaN bounds that reject every window.
 */
export function resolveExpiryBounds(league: ExpiryBoundsSource | null | undefined): ExpiryBounds {
  // Stored in hours, carried in minutes: the app floor is sub-day, so the
  // picker needs the finer unit even though a league only configures hours.
  // Written exactly as deriveExpiryBounds() on the server, including how a
  // stored 0 behaves, so the two cannot disagree about a league's floor.
  const minMinutes = (league?.trade_offer_expiry_min_hours ?? MIN_EXPIRY_MINUTES / 60) * 60
  const maxDays = league?.trade_offer_expiry_max_days ?? MAX_EXPIRY_DAYS
  const defaultHours = league?.trade_offer_expiry_default_hours ?? DEFAULT_EXPIRY_HOURS

  return {
    minMinutes,
    maxDays,
    // Clamped rather than trusted: the settings form keeps the default inside
    // the min/max it is saved with, but a league configured before a later
    // narrowing of those two can hold a default that now sits outside them, and
    // that default is what the picker opens on.
    defaultHours: Math.min(Math.max(defaultHours, minMinutes / 60), maxDays * 24),
  }
}

/**
 * Verbatim mirror of EXPIRY_ERRORS in the shared Edge Function module, so the
 * message under the picker and the server's 400 never contradict each other.
 * Change both together, pluralization included -- a user who trips the bound
 * twice sees both strings, and a word of difference between them reads as two
 * different rules.
 *
 * It cannot simply be imported: `supabase/functions/_shared/` is Deno code with
 * URL specifiers and `.ts` extensions, outside this app's module graph
 * entirely. Keeping the copies honest is a review-time obligation, which is why
 * both sides carry this note.
 */
export const EXPIRY_ERRORS = {
  tooSoon: (bounds: ExpiryBounds) =>
    `An offer has to stay open at least ${formatMinWindow(bounds.minMinutes)}`,
  tooLate: (bounds: ExpiryBounds) =>
    `An offer cannot stay open longer than ${bounds.maxDays} ${bounds.maxDays === 1 ? 'day' : 'days'}`,
  unparseable: 'Offer expiry is not a valid date',
  noReleaseDate: 'No movie in this trade is still unreleased',
} as const

/**
 * "1 hour" / "6 hours" / "30 minutes", for the minimum-window refusal.
 *
 * Character-identical to formatMinWindow() in
 * supabase/functions/_shared/trade-expiry.ts, down to the singular cases: the
 * picker's inline message disagreeing with the server's 400 by a letter is the
 * failure mode this duplication exists to avoid. A league minimum is whole
 * hours, so the minutes branch is unreachable from a league row -- it is here
 * because the copy has to match, not because something reaches it.
 */
function formatMinWindow(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`
  const hours = minutes / 60
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** The window lengths offered as chips, before a league's bounds narrow them. */
const BASE_PRESET_HOURS: readonly number[] = [24, 48, 72, 168]

/** "24h" up to two days, "3 days" beyond -- the labels the chips always had. */
function presetLabel(hours: number): string {
  return hours >= 72 && hours % 24 === 0 ? `${hours / 24} days` : `${hours}h`
}

/**
 * The preset chips a given league offers.
 *
 * Bounds narrow the list rather than greying entries out: a chip that refuses
 * on click is a worse explanation than the chip simply not being there, and the
 * commissioner's ceiling is not something the proposer can act on anyway.
 *
 * The league's own default always appears, even when it is not one of the four
 * standard lengths -- it is what the picker opens on, and an opening selection
 * with no chip lit reads as nothing being selected at all.
 */
export function expiryPresetsFor(bounds: ExpiryBounds): ReadonlyArray<{ hours: number; label: string }> {
  return [...new Set([...BASE_PRESET_HOURS, bounds.defaultHours])]
    .filter((hours) => hours * 60 >= bounds.minMinutes && hours <= bounds.maxDays * 24)
    .sort((a, b) => a - b)
    .map((hours) => ({ hours, label: presetLabel(hours) }))
}

/**
 * Extension lengths offered on an existing offer, measured from its CURRENT
 * expiry rather than from now. Kept beside the presets: "how long can an offer
 * run" is one question with one home, and the next person will look here.
 */
const BASE_EXTEND_HOURS: readonly number[] = [12, 24, 48, 72]

/**
 * The extension chips that would land inside the league's ceiling.
 *
 * The ceiling is `now + maxDays`, matching resolveOfferExpiry() on the server --
 * NOT maxDays measured from the offer's current expiry. An offer already three
 * days out therefore has fewer extensions available than a fresh one, which is
 * the rule the 400 would state anyway.
 *
 * Measuring from the current expiry instead would compound: each extension
 * would push the ceiling out with it, so an offer could be walked forward
 * indefinitely in maxDays chunks and the league's maximum would mean nothing.
 * The rule is that at any moment an offer may not stand more than maxDays into
 * the future -- do not "fix" this to be relative.
 */
export function extendPresetsFor(
  expiresAt: string,
  bounds: ExpiryBounds,
  now = Date.now()
): ReadonlyArray<{ hours: number; label: string }> {
  // Only the ceiling narrows this list. The league's MINIMUM deliberately does
  // not apply to an extension -- it can only lengthen the window, so a minimum
  // could just stop a proposer granting some extra time on an offer that is
  // already shorter than the league now permits. resolveOfferExpiry agrees:
  // extend-trade-offer passes enforceMinimum: false.
  const ceiling = now + bounds.maxDays * 24 * 60 * MS_PER_MINUTE
  return BASE_EXTEND_HOURS.filter(
    (hours) => resolveExtension(expiresAt, hours).getTime() <= ceiling
  ).map((hours) => ({ hours, label: `+${presetLabel(hours)}` }))
}

/** Push an existing expiry out by `hours`. Forward only -- see extend-trade-offer. */
export function resolveExtension(fromIso: string, hours: number): Date {
  return new Date(new Date(fromIso).getTime() + hours * 60 * 60 * 1000)
}

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
export function resolveReleaseAnchor(
  movies: ExpiryMovie[],
  bounds: ExpiryBounds,
  now = Date.now()
): ReleaseAnchor {
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

  // Both ends of the league's range apply. The soonest release could be minutes
  // away and the furthest could be past the league's ceiling; neither is bumped
  // or clamped, because a chip that named a movie it no longer waits for would
  // be lying about what it does. Whatever survives is still a real choice.
  const earliest = now + bounds.minMinutes * MS_PER_MINUTE
  const latest = now + bounds.maxDays * 24 * 60 * MS_PER_MINUTE

  const usable = candidates.filter((candidate) => {
    const at = new Date(candidate.boundary).getTime()
    return at >= earliest && at <= latest
  })

  if (usable.length === 0) {
    // Say which end ruled it out. "Out too soon" and "not for months" are
    // opposite problems and send the proposer to different fixes.
    const soonest = new Date(candidates[0].boundary).getTime()
    return {
      available: false,
      reason:
        soonest > latest
          ? `Nothing in this trade releases within ${bounds.maxDays} ${
              bounds.maxDays === 1 ? 'day' : 'days'
            }`
          : `${candidates[0].title} is out too soon`,
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
  bounds: ExpiryBounds,
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
      if (picked.getTime() < now + bounds.minMinutes * MS_PER_MINUTE) {
        return { ok: false, error: EXPIRY_ERRORS.tooSoon(bounds) }
      }
      if (picked.getTime() > now + bounds.maxDays * 24 * 60 * MS_PER_MINUTE) {
        return { ok: false, error: EXPIRY_ERRORS.tooLate(bounds) }
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
