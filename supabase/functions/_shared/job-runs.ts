/**
 * Persistent run records for scheduled jobs (cron Edge Functions).
 *
 * Each cron function starts a run after its cron auth passes and records the
 * outcome in the `job_runs` table via `finish` (normal completion, possibly
 * with per-item failures) or `fail` (the run aborted). Recording is
 * best-effort by design: neither method ever throws, so a job_runs insert
 * failure can never break a job's response path.
 */

import { createLogger, serializeError, type Logger } from './logger.ts'
import { getRequestId } from './request-context.ts'
import { alertOps } from './ops-alerts.ts'

const log = createLogger('shared/job-runs')

/** Cap on persisted per-item errors so a pathological run can't bloat the row. */
const MAX_RECORDED_ERRORS = 50

export type JobStatus = 'ok' | 'partial' | 'failed'

/**
 * Minimal structural view of a Supabase client -- just what recording a run
 * needs. Keeps this module free of esm.sh type imports so `deno check` can
 * verify it in environments where esm.sh is unreachable; any real
 * SupabaseClient satisfies it.
 */
export interface JobRunsClient {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>
    delete(options?: { count: 'exact' }): {
      lt(column: string, value: string): PromiseLike<{ count: number | null; error: unknown }>
    }
  }
}

/** The narrower slice `purgeByAge` needs. Structural for the same reason. */
export interface PurgeableClient {
  from(table: string): {
    delete(options?: { count: 'exact' }): {
      lt(column: string, value: string): PromiseLike<{ count: number | null; error: unknown }>
    }
  }
}

export interface JobRunOutcome {
  /** Items attempted (successes + failures). */
  processed: number
  /** Items that failed. */
  failed: number
  /** Per-item error details; truncated to the first 50 on insert. */
  errors?: unknown[]
  /** Job-specific extras (mode, notification summaries, ...). */
  metadata?: Record<string, unknown>
}

export interface JobRun {
  finish(supabase: JobRunsClient, outcome: JobRunOutcome): Promise<JobStatus>
  fail(supabase: JobRunsClient, err: unknown): Promise<'failed'>
}

function computeStatus(processed: number, failed: number): JobStatus {
  if (failed === 0) return 'ok'
  if (failed > 0 && failed < processed) return 'partial'
  // Covers failed >= processed > 0, and processed === 0 with failures.
  return 'failed'
}

/**
 * Fire an ops alert without letting it slow down (or break) the job's own
 * response path. Runs via EdgeRuntime.waitUntil when available so it can
 * finish after the response is sent without delaying it; otherwise it's
 * awaited inline (finish/fail are already async and already awaited by
 * callers), since the isolate may be torn down before an unawaited promise
 * settles. Mirrors the pattern in `internalErrorResponse`
 * (_shared/utils.ts), adapted for an async caller. alertOps itself never
 * throws, but this stays defensive to preserve the "recording never breaks
 * the job" guarantee.
 */
async function dispatchAlert(title: string, fields?: Record<string, unknown>): Promise<void> {
  try {
    const alert = alertOps(title, fields)
    const g = globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }
    if (g.EdgeRuntime?.waitUntil) {
      g.EdgeRuntime.waitUntil(alert)
    } else {
      await alert
    }
  } catch {
    // alertOps never throws, but this call is defensive so a scheduling
    // failure here can never take down finish()/fail()'s no-throw guarantee.
  }
}

/**
 * Begin a job run: captures the start time and returns handles that persist
 * the outcome. Call after cron auth passes so unauthorized probes are not
 * recorded.
 */
export function startJobRun(jobName: string): JobRun {
  const startedAt = new Date()

  async function record(
    supabase: JobRunsClient,
    status: JobStatus,
    outcome: JobRunOutcome
  ): Promise<void> {
    try {
      const finishedAt = new Date()

      let errors = outcome.errors && outcome.errors.length > 0 ? outcome.errors : null
      let metadata = outcome.metadata ?? null
      if (errors && errors.length > MAX_RECORDED_ERRORS) {
        metadata = { ...(metadata ?? {}), errors_truncated: { recorded: MAX_RECORDED_ERRORS, total: errors.length } }
        errors = errors.slice(0, MAX_RECORDED_ERRORS)
      }

      const { error: insertError } = await supabase.from('job_runs').insert({
        job_name: jobName,
        status,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        items_processed: outcome.processed,
        items_failed: outcome.failed,
        errors,
        request_id: getRequestId(),
        metadata,
      })

      if (insertError) {
        log.error('Failed to record job run', { job_name: jobName, status, error: serializeError(insertError) })
      }
    } catch (err) {
      // Recording must never break the job's own response path.
      log.error('Failed to record job run', { job_name: jobName, status, error: serializeError(err) })
    }
  }

  return {
    async finish(supabase, outcome): Promise<JobStatus> {
      const status = computeStatus(outcome.processed, outcome.failed)
      await record(supabase, status, outcome)

      if (status !== 'ok') {
        await dispatchAlert(`Cron ${jobName} run ${status}`, {
          job_name: jobName,
          status,
          items_processed: outcome.processed,
          items_failed: outcome.failed,
          duration_ms: Date.now() - startedAt.getTime(),
          request_id: getRequestId(),
          first_errors: outcome.errors?.slice(0, 3),
        })
      }

      return status
    },

    async fail(supabase, err): Promise<'failed'> {
      const serialized = serializeError(err)
      await record(supabase, 'failed', {
        processed: 0,
        failed: 0,
        errors: [serialized],
      })

      await dispatchAlert(`Cron ${jobName} failed`, {
        job_name: jobName,
        request_id: getRequestId(),
        error: serialized,
      })

      return 'failed'
    },
  }
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface PurgeByAgeOptions {
  /** Table to delete from. */
  table: string
  /** Timestamp column the retention window is measured on. */
  column: string
  /** Rows older than this many days are deleted. */
  retentionDays: number
  /** Logger of the calling module, so the line is attributed to it. */
  log: Logger
}

/**
 * Deletes rows whose `column` timestamp is older than `retentionDays`.
 *
 * The one retention primitive behind every table-bounding purge. Counting is
 * done server-side with `count: 'exact'` rather than by returning the deleted
 * keys -- a purge can span six figures of rows, and none of that data is
 * wanted back.
 *
 * Best-effort by contract: never throws, so a purge failure cannot break the
 * caller's own job outcome. Returns the number of rows deleted, or null if the
 * delete failed (logged either way).
 */
export async function purgeByAge(
  supabase: PurgeableClient,
  { table, column, retentionDays, log: purgeLog }: PurgeByAgeOptions
): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY).toISOString()

    const { count, error } = await supabase.from(table).delete({ count: 'exact' }).lt(column, cutoff)

    if (error) {
      purgeLog.error('Failed to purge old rows', { table, retention_days: retentionDays, error: serializeError(error) })
      return null
    }

    purgeLog.info('Purged old rows', { table, retention_days: retentionDays, rows_deleted: count ?? 0 })
    return count ?? null
  } catch (err) {
    purgeLog.error('Failed to purge old rows', { table, retention_days: retentionDays, error: serializeError(err) })
    return null
  }
}

/**
 * Delete job_runs rows older than `retentionDays` (default 90). Every
 * scheduled job records a run here -- process-trades alone adds one every 5
 * minutes, roughly 105k rows/year -- so this keeps the table bounded.
 */
export function purgeOldJobRuns(supabase: JobRunsClient, retentionDays = 90): Promise<number | null> {
  return purgeByAge(supabase, { table: 'job_runs', column: 'started_at', retentionDays, log })
}
