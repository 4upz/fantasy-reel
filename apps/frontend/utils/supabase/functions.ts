import * as Sentry from '@sentry/nextjs'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createClient } from './client'

/**
 * Helper to call Supabase Edge Functions with authentication.
 * Uses Supabase's built-in functions.invoke() which handles auth automatically.
 *
 * Every call gets a client-generated `x-request-id` header (echoed by the
 * Edge Function as `X-Request-Id`) so client-side breadcrumbs/logs can be
 * correlated with backend structured logs, plus a Sentry breadcrumb
 * recording duration/status for context on any later error event.
 */
export async function callEdgeFunction<T>(
  functionName: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  } = {}
): Promise<{ data: T | null; error: string | null }> {
  const supabase = createClient()
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()

  try {
    const { data, error } = await supabase.functions.invoke<T>(functionName, {
      method: options.method || 'POST',
      body: options.body,
      headers: { 'x-request-id': requestId },
    })

    const durationMs = performance.now() - startedAt

    if (error) {
      // Extract the actual error message from FunctionsHttpError
      if (error instanceof FunctionsHttpError) {
        const errorBody = await error.context.json()
        const errorMessage = errorBody.error || error.message

        console.error(
          `Edge Function ${functionName} returned an error [request_id=${requestId}]:`,
          errorMessage
        )

        // Business-logic error responses (4xx surfaced to the user) are an
        // expected flow, not an exception - breadcrumb only so they still
        // provide context if a later, real error is captured.
        Sentry.addBreadcrumb({
          category: 'edge-function',
          message: functionName,
          level: 'error',
          data: {
            duration_ms: durationMs,
            status: error.context.status,
            request_id: requestId,
            error: errorMessage,
          },
        })

        return { data: null, error: errorMessage }
      }

      Sentry.addBreadcrumb({
        category: 'edge-function',
        message: functionName,
        level: 'error',
        data: { duration_ms: durationMs, request_id: requestId, error: error.message },
      })

      return { data: null, error: error.message || 'Edge function error' }
    }

    Sentry.addBreadcrumb({
      category: 'edge-function',
      message: functionName,
      level: 'info',
      data: { duration_ms: durationMs, status: 'ok', request_id: requestId },
    })

    return { data, error: null }
  } catch (err) {
    // Network failures / unexpected exceptions - not an expected business
    // flow, so capture it as a real Sentry exception in addition to logging.
    console.error(`Error calling Edge Function ${functionName} [request_id=${requestId}]:`, err)

    Sentry.captureException(err, {
      tags: { edge_function: functionName },
      extra: { request_id: requestId },
    })

    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
