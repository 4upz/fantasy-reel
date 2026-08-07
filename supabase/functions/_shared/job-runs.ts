/**
 * Persistent run records for scheduled jobs (cron Edge Functions).
 *
 * Each cron function starts a run after its cron auth passes and records the
 * outcome in the `job_runs` table via `finish` (normal completion, possibly
 * with per-item failures) or `fail` (the run aborted). Recording is
 * best-effort by design: neither method ever throws, so a job_runs insert
 * failure can never break a job's response path.
 */

import { createLogger, serializeError } from './logger.ts'
import { getRequestId } from './request-context.ts'

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
      return status
    },

    async fail(supabase, err): Promise<'failed'> {
      await record(supabase, 'failed', {
        processed: 0,
        failed: 0,
        errors: [serializeError(err)],
      })
      return 'failed'
    },
  }
}
