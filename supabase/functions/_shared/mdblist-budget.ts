/**
 * Projections' slice of the MDBList daily quota (free plan: 1,000
 * requests/day, shared by nightly scoring, franchise history, pre-release
 * polling, and corpus ingestion).
 *
 * Every projections MDBList caller reserves calls through `reserveApiCalls`
 * BEFORE fetching. The ledger is `external_api_budgets` and the grant is
 * atomic (`reserve_external_api_calls`, introduced by PR #72 for franchise
 * history and copied idempotently into the projections migration). Each
 * feature reserves under its own key so one cannot exhaust another's slice:
 * franchise history uses 'mdblist:franchise-history', we use
 * 'mdblist:projections'. `fetchMdblistUsage` reads MDBList's own counter so
 * ingestion can shrink its ask when the account is already hot.
 */
import { fetchWithTimeout } from './http.ts'
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/mdblist-budget')

export const MDBLIST_PROJECTIONS_KEY = 'mdblist:projections'
/** Free-plan account cap. */
export const MDBLIST_ACCOUNT_CAP = 1000
/** Calls ingestion always leaves for the evening score sync, whatever the flag says. */
export const MDBLIST_SCORING_RESERVE = 100

export interface MdblistUsage {
  /** Daily request cap on the account. */
  cap: number
  /** Requests MDBList has counted so far today. */
  used: number
}

/** Structural client slice so this module needs no esm.sh type import. */
export interface BudgetClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

/** YYYY-MM-DD for the UTC day, matching external_api_budgets.day and MDBList's daily reset. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

/** MDBList's own usage counter for the account. Null on any failure. */
export async function fetchMdblistUsage(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<MdblistUsage | null> {
  try {
    const res = await fetchWithTimeout(`https://api.mdblist.com/user?apikey=${apiKey}`, {}, 10_000, fetchImpl)
    if (!res.ok) {
      log.warn('MDBList /user failed', { status: res.status })
      return null
    }
    const body = (await res.json()) as { api_requests?: unknown; api_requests_count?: unknown }
    if (typeof body.api_requests !== 'number' || typeof body.api_requests_count !== 'number') return null
    return { cap: body.api_requests, used: body.api_requests_count }
  } catch (err) {
    log.warn('MDBList /user error', { error_name: err instanceof Error ? err.name : typeof err })
    return null
  }
}

/**
 * Reserves up to `requested` calls under `budgetKey` for today against
 * `dailyLimit`. Returns the number actually granted (0 when the limit is
 * reached or the ledger is unreachable -- never spend on a failed
 * reservation).
 */
export async function reserveApiCalls(
  client: BudgetClient,
  budgetKey: string,
  requested: number,
  dailyLimit: number
): Promise<number> {
  if (requested <= 0) return 0
  const { data, error } = await client.rpc('reserve_external_api_calls', {
    p_api: budgetKey,
    p_requested: requested,
    p_daily_limit: dailyLimit,
  })
  if (error) {
    log.error('reserve_external_api_calls failed; granting 0', { budget_key: budgetKey, error: serializeError(error) })
    return 0
  }
  return typeof data === 'number' ? data : 0
}
