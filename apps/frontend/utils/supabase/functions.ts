import { createClient } from './client'

/**
 * Helper to call Supabase Edge Functions with authentication
 */
export async function callEdgeFunction<T>(
  functionName: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  } = {}
): Promise<{ data: T | null; error: string | null }> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return { data: null, error: 'Not authenticated' }
  }

  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1'

  try {
    const response = await fetch(`${functionsUrl}/${functionName}`, {
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    const result = await response.json()

    if (!response.ok) {
      return { data: null, error: result.error || `Request failed with status ${response.status}` }
    }

    return { data: result as T, error: null }
  } catch (err) {
    console.error(`Error calling Edge Function ${functionName}:`, err)
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
