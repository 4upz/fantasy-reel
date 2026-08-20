import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TradeItems, LeagueTradeConfig } from './trade-validation.ts'

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

export type ExpiryAnchor = 'fixed' | 'first_release'

/** How an offer's clock was chosen, as sent by the client. */
export interface ExpiryRequest {
  /**
   * ISO-8601 instant. Required for `fixed`, ignored for `first_release` (the
   * server re-derives that one -- the client's arithmetic is a UI preview, and
   * the movie set it was computed against may not be the one being saved).
   */
  expires_at?: string | null
  expiry_anchor?: ExpiryAnchor | null
}

/** What actually gets written to `trade_offers`. */
export interface ResolvedExpiry {
  expires_at: string | null
  expiry_anchor: ExpiryAnchor | null
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
  noReleaseDate: 'No movie in this trade has a release date to expire on',
  alreadyReleased: 'The first movie in this trade is already released',
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
 * Earliest release among the movies on BOTH sides of the offer, as the instant
 * that movie stops counting as upcoming.
 *
 * Delegates to the SQL function so the boundary is defined once. It resolves
 * against live `movies.release_date` -- the `release_date` inside the items
 * JSONB is a snapshot `enrichTradeItems` took at proposal time and drifts every
 * time sync-release-dates moves a date.
 */
export async function resolveFirstRelease(
  supabase: SupabaseClient,
  initiatorItems: TradeItems,
  recipientItems: TradeItems
): Promise<Date | null> {
  const { data, error } = await supabase.rpc('resolve_first_release_expiry', {
    p_initiator_items: initiatorItems,
    p_recipient_items: recipientItems,
  })

  if (error || !data) return null

  const resolved = new Date(data as string)
  return Number.isNaN(resolved.getTime()) ? null : resolved
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
    leagueConfig: Pick<LeagueTradeConfig, 'trade_deadline'>
    initiatorItems: TradeItems
    recipientItems: TradeItems
  }
): Promise<ExpiryResolution> {
  const anchor = request?.expiry_anchor ?? null
  const requested = request?.expires_at ?? null

  // No clock: the pre-expiry behavior, and what every offer created before this
  // feature keeps. Deliberately still a first-class choice.
  if (anchor === null && requested === null) {
    return { valid: true, expires_at: null, expiry_anchor: null }
  }

  if (anchor === null || (anchor === 'fixed' && requested === null)) {
    return { valid: false, error: EXPIRY_ERRORS.unpaired }
  }

  if (anchor !== 'fixed' && anchor !== 'first_release') {
    return { valid: false, error: EXPIRY_ERRORS.unknownAnchor }
  }

  const now = Date.now()
  const earliest = now + MIN_EXPIRY_MINUTES * MS_PER_MINUTE
  let expiry: Date

  if (anchor === 'first_release') {
    const resolved = await resolveFirstRelease(supabase, context.initiatorItems, context.recipientItems)

    if (!resolved) return { valid: false, error: EXPIRY_ERRORS.noReleaseDate }
    // Trading a released movie is legal, so this is a normal case rather than a
    // data problem -- the option simply does not apply to this offer.
    if (resolved.getTime() <= now) return { valid: false, error: EXPIRY_ERRORS.alreadyReleased }
    if (resolved.getTime() < earliest) return { valid: false, error: EXPIRY_ERRORS.tooSoon }

    expiry = resolved
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
  const deadline = leagueDeadlineInstant(context.leagueConfig.trade_deadline)
  if (deadline && expiry > deadline) expiry = deadline

  // Whole minutes: a custom picker that stores :37 seconds would render as
  // "in 59 minutes" for a window the user set to exactly one hour.
  expiry.setUTCSeconds(0, 0)

  return { valid: true, expires_at: expiry.toISOString(), expiry_anchor: anchor }
}

/** Whether an offer's clock has already run out, wherever its status says. */
export function hasLapsed(expiresAt: string | null | undefined): boolean {
  return expiresAt != null && new Date(expiresAt).getTime() <= Date.now()
}
