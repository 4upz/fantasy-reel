import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TradeItems } from './trade-validation.ts'

/**
 * Per-offer trade expiry: how long an unanswered offer stands before it lapses.
 *
 * Not to be confused with the two clocks that already existed --
 * `leagues.trade_deadline` (season-level, last date a trade may happen) and
 * `trade_offers.review_ends_at` (post-accept commissioner window). See
 * docs/PLAN-trade-offer-expiry.md.
 *
 * This module is the ONLY place that turns a client's request into a stored
 * `expires_at`. The picker in the UI enforces the same bounds for a better
 * error, but a crafted request skips it entirely, so nothing here may assume
 * the client has already checked anything.
 */

export type ExpiryAnchor = 'fixed' | 'movie_release'

/** An unreleased movie in an offer, i.e. something its expiry could wait on. */
export interface AnchorCandidate {
  movie_id: string
  title: string
  release_date: string
  /** When it stops counting as upcoming: start of the day after release, UTC. */
  boundary: string
}

/** How an offer's clock was chosen, as sent by the client. */
export interface ExpiryRequest {
  /**
   * ISO-8601 instant. Required for `fixed`, ignored for `movie_release` (the
   * server derives that one from the anchor movie's live release date).
   */
  expires_at?: string | null
  expiry_anchor?: ExpiryAnchor | null
  /**
   * Which movie a `movie_release` offer waits on. Omit to take the default --
   * the soonest unreleased movie in the offer. Must be a movie in the offer
   * that is still unreleased; anything else is refused rather than corrected,
   * since silently anchoring to a different movie than the one asked for is
   * worse than saying no.
   */
  expiry_anchor_movie_id?: string | null
}

/** What actually gets written to `trade_offers`. */
export interface ResolvedExpiry {
  expires_at: string | null
  expiry_anchor: ExpiryAnchor | null
  expiry_anchor_movie_id: string | null
}

export type ExpiryResolution =
  | ({ valid: true } & ResolvedExpiry)
  | { valid: false; error: string }

/**
 * An offer has to stand long enough to actually be read. A five-minute window
 * is a pressure tactic, not a deadline -- and a custom time picker is exactly
 * where someone would try to set one.
 */
export const MIN_EXPIRY_MINUTES = 60
export const MAX_EXPIRY_DAYS = 14

/**
 * User-facing refusals. The frontend keeps its own copy of these strings
 * (apps/frontend/utils/tradeExpiry.ts) so the inline picker message and the
 * server's 400 never contradict each other -- change both together.
 */
export const EXPIRY_ERRORS = {
  unpaired: 'An expiry and how it was chosen must be sent together',
  unknownAnchor: 'Unknown expiry option',
  unparseable: 'Offer expiry is not a valid date',
  tooSoon: `An offer has to stay open at least ${MIN_EXPIRY_MINUTES / 60} hour`,
  tooLate: `An offer cannot stay open longer than ${MAX_EXPIRY_DAYS} days`,
  noReleaseDate: 'No movie in this trade is still unreleased',
  anchorNotInOffer: 'That movie is not an unreleased movie in this trade',
} as const

const MS_PER_MINUTE = 60_000

/**
 * The instant a league's trade deadline closes.
 *
 * `leagues.trade_deadline` is a bare DATE and the deadline day is inclusive
 * (`validateLeagueTradingEnabled` reads it as end-of-day). That existing check
 * uses the Edge Function's locale; this one is explicitly UTC, matching
 * `expire_lapsed_trade_offers()` so the sweep and the clamp agree.
 */
function leagueDeadlineInstant(tradeDeadline: string | null): Date | null {
  if (!tradeDeadline) return null
  const end = new Date(`${tradeDeadline}T00:00:00.000Z`)
  if (Number.isNaN(end.getTime())) return null
  end.setUTCDate(end.getUTCDate() + 1)
  return end
}

/**
 * The movies in an offer its expiry could wait on: still unreleased, soonest
 * first. The first is the default.
 *
 * Delegates to SQL so the boundary and the "still unreleased" test are defined
 * once, against live `movies.release_date` -- the `release_date` inside the
 * items JSONB is a snapshot `enrichTradeItems` took at proposal time and drifts
 * every time sync-release-dates moves a date.
 */
export async function getAnchorCandidates(
  supabase: SupabaseClient,
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): Promise<AnchorCandidate[]> {
  const { data, error } = await supabase.rpc('offer_anchor_candidates', {
    p_initiator_items: initiatorItems,
    p_recipient_items: recipientItems,
  })

  if (error || !data) return []
  return data as AnchorCandidate[]
}

/**
 * Turn a client's expiry request into the timestamp to store, or a refusal.
 *
 * Every option -- preset, custom time, release anchor -- collapses to one
 * resolved instant, so the sweep, the index, the countdown and the guards all
 * have exactly one thing to compare.
 */
export async function resolveOfferExpiry(
  supabase: SupabaseClient,
  request: ExpiryRequest | undefined,
  context: {
    /** `leagues.trade_deadline`, the season-level clock, or null if unset. */
    tradeDeadline: string | null
    initiatorItems: TradeItems
    recipientItems: TradeItems
  }
): Promise<ExpiryResolution> {
  const anchor = request?.expiry_anchor ?? null
  const requested = request?.expires_at ?? null

  // No clock: the pre-expiry behavior, and what every offer created before this
  // feature keeps. Deliberately still a first-class choice.
  if (anchor === null && requested === null) {
    return { valid: true, expires_at: null, expiry_anchor: null, expiry_anchor_movie_id: null }
  }

  if (anchor === null || (anchor === 'fixed' && requested === null)) {
    return { valid: false, error: EXPIRY_ERRORS.unpaired }
  }

  if (anchor !== 'fixed' && anchor !== 'movie_release') {
    return { valid: false, error: EXPIRY_ERRORS.unknownAnchor }
  }

  const now = Date.now()
  const earliest = now + MIN_EXPIRY_MINUTES * MS_PER_MINUTE
  let expiry: Date
  let anchorMovieId: string | null = null

  if (anchor === 'movie_release') {
    const candidates = await getAnchorCandidates(
      supabase,
      context.initiatorItems,
      context.recipientItems
    )

    // Every unreleased movie is a candidate, so this only fires when the whole
    // deal is already-released movies -- a normal trade, just not one this
    // option applies to.
    if (candidates.length === 0) return { valid: false, error: EXPIRY_ERRORS.noReleaseDate }

    const requestedId = request?.expiry_anchor_movie_id ?? null
    // Default: the soonest. The client sends an explicit id when the proposer
    // picked a later release instead.
    const chosen = requestedId
      ? candidates.find((candidate) => candidate.movie_id === requestedId)
      : candidates[0]

    if (!chosen) return { valid: false, error: EXPIRY_ERRORS.anchorNotInOffer }

    const boundary = new Date(chosen.boundary)
    if (Number.isNaN(boundary.getTime())) return { valid: false, error: EXPIRY_ERRORS.unparseable }
    if (boundary.getTime() < earliest) return { valid: false, error: EXPIRY_ERRORS.tooSoon }

    expiry = boundary
    anchorMovieId = chosen.movie_id
  } else {
    expiry = new Date(requested as string)

    if (Number.isNaN(expiry.getTime())) return { valid: false, error: EXPIRY_ERRORS.unparseable }
    if (expiry.getTime() < earliest) return { valid: false, error: EXPIRY_ERRORS.tooSoon }
    if (expiry.getTime() > now + MAX_EXPIRY_DAYS * 24 * 60 * MS_PER_MINUTE) {
      return { valid: false, error: EXPIRY_ERRORS.tooLate }
    }
  }

  // An offer that outlives the season deadline can never be accepted, so clamp
  // rather than let it die later with a confusing error. The clamp may land
  // inside the minimum window -- that is fine and not a refusal: the minimum
  // exists to stop pressure tactics, and a league deadline is not one.
  const deadline = leagueDeadlineInstant(context.tradeDeadline)
  if (deadline && expiry > deadline) expiry = deadline

  // Whole minutes: a custom picker that stores :37 seconds would render as
  // "in 59 minutes" for a window the user set to exactly one hour.
  expiry.setUTCSeconds(0, 0)

  return {
    valid: true,
    expires_at: expiry.toISOString(),
    expiry_anchor: anchor,
    expiry_anchor_movie_id: anchorMovieId,
  }
}

/**
 * The title of the movie an offer waits on.
 *
 * A lookup by the id the server already resolved, NOT a re-derivation of which
 * movie the anchor points at. The titles here come from the items JSONB
 * snapshot, which is right for naming a movie in a sentence; the id is the
 * authority on which one.
 */
export function anchorMovieTitle(offer: {
  expiry_anchor_movie_id?: string | null
  initiator_items: TradeItems
  recipient_items: TradeItems
}): string | null {
  if (!offer.expiry_anchor_movie_id) return null

  const named = [...(offer.initiator_items.movies ?? []), ...(offer.recipient_items.movies ?? [])]
    .find((movie) => movie.movie_id === offer.expiry_anchor_movie_id)

  return named?.title ?? null
}

/**
 * Why an expired offer expired, phrased for the people who were waiting on it.
 *
 * Kept in step with expiredReasonCopy() in apps/frontend/utils/tradeExpiry.ts,
 * which says the same things on the card -- the frontend cannot import from
 * here, so the two are deliberate mirrors.
 */
export function expiredReasonText(trade: {
  expired_reason?: string | null
  expiry_anchor_movie_id?: string | null
  initiator_items: TradeItems
  recipient_items: TradeItems
  /** Resolved live by the caller; preferred over the JSONB snapshot title. */
  anchor_movie_title?: string | null
}): string {
  switch (trade.expired_reason) {
    case 'movie_released': {
      const title = trade.anchor_movie_title ?? anchorMovieTitle(trade)
      return title
        ? `The offer ran until ${title} released, and it has.`
        : 'The offer ran until its first movie released, and it has.'
    }
    case 'league_deadline':
      return 'The league trade deadline passed before it was answered.'
    case 'offer_window':
      return 'It expired before it was answered.'
    default:
      // Not one of the offer-expiry reasons -- a competing trade executed, or
      // the trade stopped validating. Those carry veto_reason instead, so say
      // nothing rather than describing them as an ordinary lapse.
      return 'It could not be completed.'
  }
}

/** Whether an offer's clock has already run out, wherever its status says. */
export function hasLapsed(expiresAt: string | null | undefined): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() <= Date.now()
}
