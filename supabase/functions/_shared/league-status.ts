import { errorResponse } from './utils.ts'

/**
 * The one refusal message a finished season gives, everywhere.
 *
 * "Season", not "league": a league is the series that spans years, a season is
 * the one `leagues` row that just ended. The user has not lost their league --
 * they have reached the end of a season, and the next one is a rollover away.
 */
export const SEASON_FINISHED_MESSAGE = 'This season is finished.'

/** The `leagues.status` value that freezes a season. */
export const COMPLETED_STATUS = 'completed'

export type WritableResult =
  | { ok: true }
  | { ok: false; response: Response }

/**
 * Whether a league still accepts writes.
 *
 * A completed season is immutable: its standings are final, its
 * `winner_team_ids` are recorded, and nothing that could move a team's score
 * or roster may happen afterwards. Every write Edge Function calls this right
 * after it reads the league, so the refusal is one message rather than
 * fourteen slightly different ones.
 *
 * 400 rather than 403: the caller is not unauthorized, the request is simply
 * no longer meaningful. Nobody -- not even the commissioner -- gets past this;
 * reopening a season for corrections is a separate, deliberate action that
 * does not exist yet.
 *
 * Returns a discriminated result rather than throwing so callers keep their
 * existing `return response` shape:
 *
 *   const writable = assertLeagueWritable(league)
 *   if (!writable.ok) return writable.response
 *
 * A missing league is writable. Several callers reach the league through an
 * optional read or a PostgREST embed that can come back null, and none of them
 * treats that as a finished season -- they either have their own not-found
 * branch or deliberately carry on. Accepting null here is what lets every call
 * site be the same two lines instead of two lines wrapped in an `if`.
 */
export function assertLeagueWritable(
  league: { status: string | null } | null | undefined
): WritableResult {
  if (league?.status === COMPLETED_STATUS) {
    return { ok: false, response: errorResponse(SEASON_FINISHED_MESSAGE, 400) }
  }
  return { ok: true }
}
