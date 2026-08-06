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
