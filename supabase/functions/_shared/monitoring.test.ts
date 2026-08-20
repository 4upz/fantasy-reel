/**
 * Unit tests for the DSN gate on recordCacheOutcome.
 *
 * The Sentry-active path is deliberately untested here: it would import the
 * real npm:@sentry/deno and attempt network delivery. The gate is the part a
 * regression would silently break -- an accidental import or throw on the
 * no-DSN path taxes every cached request in local dev and tests.
 */

import { assertEquals } from '@std/assert'
import { recordCacheOutcome } from './monitoring.ts'

Deno.test('recordCacheOutcome - is a synchronous no-op without SENTRY_DSN', () => {
  const saved = Deno.env.get('SENTRY_DSN')
  Deno.env.delete('SENTRY_DSN')
  try {
    assertEquals(recordCacheOutcome({ cacheKey: 'browse:page=1', status: 'hit' }), undefined)
    assertEquals(
      recordCacheOutcome({
        cacheKey: 'movie_details:tmdb_id=1',
        status: 'stale',
        alert: 'serving_stale',
        expiredForSeconds: 7200,
      }),
      undefined
    )
  } finally {
    if (saved !== undefined) Deno.env.set('SENTRY_DSN', saved)
  }
})
