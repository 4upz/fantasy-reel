/**
 * Freezes a movie's projection the first time a real Tomatometer score
 * lands, so projected-vs-actual is never silently rewritten by a later
 * score refresh.
 *
 * Used by: update-scores (both the nightly released-set path and the
 * pre-release polling path -- either can be the first real score a movie
 * gets).
 */
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/projection-freeze')

/** Structural client slice so this module needs no esm.sh type import. */
export interface FreezeClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, val: unknown): {
        is(col: string, val: unknown): PromiseLike<{ error: unknown }>
      }
    }
  }
}

/** Just the fields freezeProjection reads off a normalized rating. */
export interface FreezeRating {
  source: string | null
  score: number | null
}

/**
 * Stamps `movie_projections.frozen_at`/`actual_rt` from the `rotten_tomatoes`
 * entry in `ratings`, if any. No-op (`'skipped'`) when there is no RT rating
 * -- the movie may still be scoreless, or this run's ratings genuinely had
 * none. The `.is('frozen_at', null)` guard means a movie with no projection
 * row, or one already frozen, is also a silent no-op at the DB level rather
 * than a second condition here. Never throws -- a failed freeze is logged
 * and reported as `'failed'` so the caller can decide whether it's fatal
 * (currently: never -- scoring itself already succeeded).
 */
export async function freezeProjection(
  client: FreezeClient,
  tmdbId: number,
  ratings: FreezeRating[],
  now: string = new Date().toISOString()
): Promise<'frozen' | 'skipped' | 'failed'> {
  const rt = ratings.find((r) => r.source === 'rotten_tomatoes')?.score
  if (rt == null) return 'skipped'

  const { error } = await client
    .from('movie_projections')
    .update({ frozen_at: now, actual_rt: Math.round(rt) })
    .eq('tmdb_id', tmdbId)
    .is('frozen_at', null)

  if (error) {
    log.warn('Projection freeze failed', { tmdb_id: tmdbId, error: serializeError(error) })
    return 'failed'
  }
  return 'frozen'
}
