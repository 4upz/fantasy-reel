/**
 * Structured logging for Edge Functions. Emits one JSON line per call so
 * platform log ingestion can parse fields instead of scraping strings.
 */

import { getRequestId } from './request-context.ts'

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
  code?: string
  details?: string
  hint?: string
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    // PostgrestError and friends carry code/details/hint — the most
    // diagnostic parts of a DB failure. Include them when present.
    const { code, details, hint } = err as Error & {
      code?: string
      details?: string
      hint?: string
    }
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof details === 'string' ? { details } : {}),
      ...(typeof hint === 'string' ? { hint } : {}),
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    // PostgrestError is a plain object in some supabase-js versions.
    const e = err as { message: unknown; code?: unknown; details?: unknown; hint?: unknown }
    return {
      name: 'name' in err ? String((err as { name: unknown }).name) : 'Object',
      message: String(e.message),
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
      ...(typeof e.details === 'string' ? { details: e.details } : {}),
      ...(typeof e.hint === 'string' ? { hint: e.hint } : {}),
    }
  }
  return { name: 'Unknown', message: String(err) }
}

function log(
  method: (line: string) => void,
  level: 'info' | 'warn' | 'error',
  fn: string,
  msg: string,
  fields?: Record<string, unknown>
): void {
  method(JSON.stringify({ level, fn, request_id: getRequestId(), msg, ...fields }))
}

export function createLogger(fn: string): Logger {
  return {
    info: (msg, fields) => log(console.log, 'info', fn, msg, fields),
    warn: (msg, fields) => log(console.warn, 'warn', fn, msg, fields),
    error: (msg, fields) => log(console.error, 'error', fn, msg, fields),
  }
}
