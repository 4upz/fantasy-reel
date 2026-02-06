/**
 * Worker-scoped unique ID generation for parallel E2E tests
 *
 * Prevents data collisions when Playwright runs tests in parallel workers.
 * Each worker gets its own ID range to ensure complete isolation.
 *
 * @see https://supabase.com/docs/guides/local-development/testing/overview
 */

import { randomUUID } from 'crypto'

let workerIndex: number = 0

/**
 * Set the worker index for this test worker.
 * Should be called early in the test setup, typically in a fixture.
 *
 * @param index - The Playwright parallelIndex (0-based worker number)
 */
export function setWorkerIndex(index: number): void {
  workerIndex = index
}

/**
 * Get the current worker index.
 * @returns The worker index (0 if not set)
 */
export function getWorkerIndex(): number {
  return workerIndex
}

/**
 * Generate a unique TMDB ID for this worker.
 *
 * Each worker gets 10000 IDs in distinct ranges:
 * - Worker 0: 900000-909999
 * - Worker 1: 910000-919999
 * - Worker 2: 920000-929999
 * - etc.
 *
 * This prevents upsert race conditions when parallel workers create movies.
 *
 * @param localId - A number 0-9999 identifying the movie within this worker's tests
 * @returns A unique TMDB ID
 */
export function uniqueTmdbId(localId: number): number {
  if (localId < 0 || localId >= 10000) {
    throw new Error(`localId must be 0-9999, got ${localId}`)
  }
  const base = 900000 + workerIndex * 10000
  return base + localId
}

/**
 * Generate a unique user email for this worker.
 *
 * Format: test-{prefix}-w{workerIndex}-{timestamp}-{uuid}@test.local
 *
 * Uses UUID instead of Math.random() for better uniqueness guarantees
 * and prevents email collisions even if workers start at the same millisecond.
 *
 * @param prefix - A descriptive prefix (e.g., "primary", "owner")
 * @returns A unique email address
 */
export function uniqueEmail(prefix: string): string {
  const uuid = randomUUID().slice(0, 8)
  return `test-${prefix}-w${workerIndex}-${Date.now()}-${uuid}@test.local`
}

/**
 * Generate a unique league name for this worker.
 *
 * Format: {baseName} W{workerIndex}-{timestamp}
 *
 * @param baseName - The base name for the league
 * @returns A unique league name
 */
export function uniqueLeagueName(baseName: string): string {
  const timestamp = Date.now()
  return `${baseName} W${workerIndex}-${timestamp}`
}

/**
 * Generate a unique token/code for this worker.
 *
 * Format: {prefix}-w{workerIndex}-{timestamp}-{random}
 *
 * @param prefix - A prefix for the token
 * @returns A unique token string
 */
export function uniqueToken(prefix: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-w${workerIndex}-${timestamp}-${random}`
}

/**
 * Get a worker-specific prefix for filtering test data during cleanup.
 *
 * @returns A prefix string like "w0", "w1", etc.
 */
export function getWorkerPrefix(): string {
  return `w${workerIndex}`
}
