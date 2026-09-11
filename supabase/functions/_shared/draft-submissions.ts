import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidUUID } from './utils.ts'

export class DraftSubmissionError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'DraftSubmissionError'
  }
}

export async function readDraftBody<T extends object = Record<string, unknown>>(req: Request): Promise<T> {
  let body: unknown
  try { body = await req.json() } catch {
    throw new DraftSubmissionError('A valid JSON object is required', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DraftSubmissionError('A valid JSON object is required', 400)
  }
  return body as T
}

export function parseDraftAttempt(body: { request_id?: unknown; expected_pick?: unknown }) {
  if (body.request_id !== undefined && (typeof body.request_id !== 'string' || !isValidUUID(body.request_id))) {
    throw new DraftSubmissionError('Valid request_id is required', 400)
  }
  if (body.expected_pick !== undefined && (typeof body.expected_pick !== 'number' ||
    !Number.isSafeInteger(body.expected_pick) || body.expected_pick < 1 || body.expected_pick > 2_147_483_647)) {
    throw new DraftSubmissionError('Valid expected_pick is required', 400)
  }
  return { requestId: body.request_id ?? crypto.randomUUID(), expectedPick: body.expected_pick }
}

/** Look up a committed attempt before checking phase or calling TMDb again. */
export async function findDraftReplay(client: SupabaseClient, attempt: {
  requestId: string; leagueId: string; userId: string; kind: 'draft' | 'counterpick';
  expectedPick?: number; movieId?: string; tmdbId?: number;
}): Promise<{ movie_id: string; expected_pick: number } | null> {
  const { data, error } = await client.from('draft_submissions')
    .select('league_id,user_id,movie_id,kind,expected_pick,result_id,movies(tmdb_id)')
    .eq('request_id', attempt.requestId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const movie = data.movies as unknown as { tmdb_id: number }
  if (data.league_id !== attempt.leagueId || data.user_id !== attempt.userId || data.kind !== attempt.kind ||
    (attempt.expectedPick !== undefined && data.expected_pick !== attempt.expectedPick) ||
    (attempt.movieId !== undefined && data.movie_id !== attempt.movieId) ||
    (attempt.tmdbId !== undefined && movie.tmdb_id !== attempt.tmdbId)) {
    throw new DraftSubmissionError('This request ID was already used for a different selection', 409)
  }
  return data.result_id ? data : null
}

export function throwDraftRpcError(error: { code: string; message: string } | null): void {
  if (!error) return
  if (['PT400', 'PT403', 'PT404', 'PT409'].includes(error.code)) {
    throw new DraftSubmissionError(error.message, Number(error.code.slice(2)))
  }
  throw error
}
