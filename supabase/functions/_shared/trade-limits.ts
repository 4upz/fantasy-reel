import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Limits on trade offers, mirrored by the enforce_trade_offer_limits trigger
 * (20261003152600_size_and_count_limits.sql). The functions check first so the
 * caller gets a clear 400 instead of a constraint error.
 */
export const MAX_TRADE_MESSAGE_LENGTH = 1500
export const MAX_OPEN_TRADE_OFFERS_PER_TEAM = 25

/** Returns an error for a trade message or veto reason that can't be stored, else null. */
export function tradeMessageError(value: unknown, label = 'Message'): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return `${label} must be text`
  if (value.trim().length > MAX_TRADE_MESSAGE_LENGTH) {
    return `${label} can be at most ${MAX_TRADE_MESSAGE_LENGTH} characters`
  }
  return null
}

/**
 * Returns an error when the team already has the maximum number of open
 * offers it proposed, else null. A failed count is not a reason to refuse:
 * the database trigger still holds the line.
 */
export async function openTradeOfferLimitError(
  client: SupabaseClient,
  teamId: string,
): Promise<string | null> {
  const { count, error } = await client
    .from('trade_offers')
    .select('id', { count: 'exact', head: true })
    .eq('initiator_team_id', teamId)
    .in('status', ['proposed', 'countered'])

  if (error || count === null) return null
  return count >= MAX_OPEN_TRADE_OFFERS_PER_TEAM
    ? `Your team already has ${MAX_OPEN_TRADE_OFFERS_PER_TEAM} open trade offers. Cancel some before proposing more.`
    : null
}
