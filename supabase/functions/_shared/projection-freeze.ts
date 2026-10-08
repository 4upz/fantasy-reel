/**
 * Freezes a movie's projection when its real Tomatometer starts to count, so
 * projected-vs-actual is never silently rewritten by a later model run.
 *
 * Only a released movie's score freezes anything. Main polls rostered movies
 * before release, and a pre-release Tomatometer is usually a festival or
 * embargo-lift score on a few dozen reviews: freezing on it would record that
 * early number as the outcome. Once frozen, `actual_rt` keeps tracking the
 * movie's current score on every later scoring run (the nightly sync keeps
 * re-scoring released movies), so it ends at the settled value rather than
 * the release-day one; `frozen_at` is stamped once and never moves.
 *
 * Used by: update-scores, after each successful calculate_movie_score.
 */
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/projection-freeze')

type WriteResult = PromiseLike<{ error: unknown }>

/** Structural client slice so this module needs no esm.sh type import. */
export interface FreezeClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, val: unknown): WriteResult & {
        is(col: string, val: unknown): WriteResult
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
 * Stamps `movie_projections.frozen_at` (once) and `actual_rt` (every time)
 * from the `rotten_tomatoes` entry in `ratings`. `'skipped'` when the movie
 * has not released or there is no RT rating. A movie with no projection row
 * is a silent no-op at the DB level. Never throws -- a failed freeze is
 * logged and reported as `'failed'`; scoring itself already succeeded.
 */
export async function freezeProjection(
  client: FreezeClient,
  tmdbId: number,
  ratings: FreezeRating[],
  released: boolean,
  now: string = new Date().toISOString()
): Promise<'frozen' | 'skipped' | 'failed'> {
  const rt = ratings.find((r) => r.source === 'rotten_tomatoes')?.score
  if (rt == null || !released) return 'skipped'

  const projections = () => client.from('movie_projections')
  const freeze = await projections().update({ frozen_at: now }).eq('tmdb_id', tmdbId).is('frozen_at', null)
  const { error } = freeze.error
    ? freeze
    : await projections().update({ actual_rt: Math.round(rt) }).eq('tmdb_id', tmdbId)

  if (error) {
    log.warn('Projection freeze failed', { tmdb_id: tmdbId, error: serializeError(error) })
    return 'failed'
  }
  return 'frozen'
}
