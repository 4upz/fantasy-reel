import { track } from '@vercel/analytics'

/**
 * Thin wrapper around the analytics vendor (`@vercel/analytics`) so it can be
 * swapped later without touching call sites.
 *
 * Canonical event names (keep this list in sync with actual call sites):
 * - `league_created`        — { league_id }
 * - `league_joined`         — { league_id }
 * - `draft_started`         — { league_id }
 * - `draft_pick_made`       — { league_id, round }
 * - `bid_placed`            — { league_id, amount }
 * - `counterpick_made`      — { league_id }
 * - `trade_proposed`        — { league_id }
 * - `trade_accepted`        — { league_id }
 * - `trade_rejected`        — { league_id }
 * - `realtime_degraded`     — { league_id, status }
 * - `realtime_recovered`    — { league_id }
 *
 * Fire only at the SUCCESS point of a user action (after the API/action
 * succeeds), never on click, error, or cancel paths. Keep props limited to
 * IDs and other non-identifying values — no names, emails, or other PII.
 */
export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean | null>
): void {
  if (typeof window === 'undefined') return

  try {
    track(name, props)
  } catch {
    // Analytics must never break the app.
  }
}
