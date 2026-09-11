// Host shim for `@/utils/supabase/functions`. Components in this design
// system call Edge Functions for their write actions (place bid, accept
// trade, …). The design renderer has no Supabase project and no session, so
// the call resolves as a no-op success instead of throwing a network error —
// the component's own loading/disabled/success states still exercise exactly
// as they do in the app.
export async function callEdgeFunction<T>(
  _functionName: string,
  _options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {}
): Promise<{ data: T | null; error: string | null }> {
  return { data: null, error: null }
}

// SWR movie reads need the same export as the app. Browsing has an honest
// empty result offline; detail reads require a supplied fixture or show the
// component's normal error state instead of inventing a movie response.
export async function edgeFetcher<T>(
  functionName: string,
  body: Record<string, unknown>
): Promise<T> {
  if (functionName === 'browse-movies' || functionName === 'search-movies') {
    return {
      results: [],
      page: typeof body.page === 'number' ? body.page : 1,
      total_pages: 0,
      total_results: 0,
    } as T
  }
  throw new Error('Live movie details are unavailable in the standalone design preview.')
}
