import { FunctionsHttpError } from '@supabase/supabase-js'
import { createClient } from './client'

/**
 * Helper to call Supabase Edge Functions with authentication.
 * Uses Supabase's built-in functions.invoke() which handles auth automatically.
 */
export async function callEdgeFunction<T>(
  functionName: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  } = {}
): Promise<{ data: T | null; error: string | null }> {
  const supabase = createClient()

  try {
    const { data, error } = await supabase.functions.invoke<T>(functionName, {
      method: options.method || 'POST',
      body: options.body,
    })

    if (error) {
      // Extract the actual error message from FunctionsHttpError
      if (error instanceof FunctionsHttpError) {
        const errorBody = await error.context.json()
        return { data: null, error: errorBody.error || error.message }
      }
      return { data: null, error: error.message || 'Edge function error' }
    }

    return { data, error: null }
  } catch (err) {
    console.error(`Error calling Edge Function ${functionName}:`, err)
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
