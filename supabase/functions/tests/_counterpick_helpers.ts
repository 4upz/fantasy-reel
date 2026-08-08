/**
 * Shared helpers for suites that exercise counterpick bidding through
 * process-bids or seed counterpick_bids rows directly. Previously copied
 * per-file (process-bids-counterpick-slots, process-bids-dropped-targets,
 * drop-movie); factored here so a change to how tests reach process-bids or
 * to the counterpick_bids schema is made once.
 *
 * Deliberately NOT named *.test.ts so the test runner doesn't try to execute
 * it, same as _setup.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getEdgeFunctionServiceRoleKey, TestDataFactory } from './_setup.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'

/**
 * The `supabase start` edge runtime serves the *main checkout's* functions, so a
 * worktree change is only exercised by pointing PROCESS_BIDS_URL at a standalone
 * `deno run process-bids/index.ts` (which binds :8000). That process reads its
 * service role key from .env.test, whereas the container has its own -- so the
 * key has to follow the URL.
 */
const STANDALONE_URL = Deno.env.get('PROCESS_BIDS_URL')
export const PROCESS_BIDS_FUNCTION_URL =
  STANDALONE_URL || `${SUPABASE_URL}/functions/v1/process-bids`

/** A processing_deadline safely in the past, so seeded bids are always due. */
export const PAST_DEADLINE = new Date(Date.now() - 60 * 60 * 1000).toISOString()

export interface ProcessBidsResponse {
  status: number
  // deno-lint-ignore no-explicit-any
  data: any
}

/**
 * Resolve the service-role key appropriate for where process-bids is running
 * (standalone vs the supabase start container) and return a caller bound to it.
 */
export async function createProcessBidsCaller(): Promise<
  (body: Record<string, unknown>) => Promise<ProcessBidsResponse>
> {
  const serviceRoleKey = STANDALONE_URL
    ? (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    : await getEdgeFunctionServiceRoleKey()

  return async function callProcessBids(body: Record<string, unknown>): Promise<ProcessBidsResponse> {
    const response = await fetch(PROCESS_BIDS_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    try {
      return { status: response.status, data: JSON.parse(text) }
    } catch {
      return { status: response.status, data: { raw: text } }
    }
  }
}

/**
 * Seed a counterpick_bids row directly, simulating a bid placed during the
 * FAAB auction phase without going through place-counterpick-bid. Exactly one
 * of draftPickId / pickupId must be provided (the table's CHECK enforces it).
 */
export async function seedCounterpickBid(
  serviceClient: SupabaseClient,
  params: {
    leagueId: string
    teamId: string
    movieId: string
    targetTeamId: string
    draftPickId?: string
    pickupId?: string
    amount: number
    priority?: number
    status?: 'active' | 'outbid' | 'cancelled'
    processingDeadline?: string
  },
): Promise<string> {
  const { data, error } = await serviceClient
    .from('counterpick_bids')
    .insert({
      league_id: params.leagueId,
      team_id: params.teamId,
      movie_id: params.movieId,
      target_team_id: params.targetTeamId,
      draft_pick_id: params.draftPickId ?? null,
      pickup_id: params.pickupId ?? null,
      amount: params.amount,
      priority: params.priority ?? 1,
      status: params.status ?? 'active',
      processing_deadline: params.processingDeadline ?? PAST_DEADLINE,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to seed counterpick bid: ${error?.message}`)
  return data.id
}

/** `factory.getTeamForUser`, unwrapped -- throws instead of returning null. */
export async function teamForOrThrow(
  factory: TestDataFactory,
  leagueId: string,
  userClient: SupabaseClient,
): Promise<string> {
  const team = await factory.getTeamForUser(leagueId, userClient)
  if (!team) throw new Error(`Team not found for user in league ${leagueId}`)
  return team.teamId
}
