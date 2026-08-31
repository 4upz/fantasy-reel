/**
 * Shared in-memory mock Supabase client for unit-testing the scheduled
 * notification Edge Functions (release-day-announcements,
 * weekly-releases-digest, sync-release-dates, send-announcement,
 * bid-cutoff-announcement).
 *
 * Not a test file itself (no `.test.ts` suffix), so `deno task test:unit`
 * does not execute it directly -- it's imported by the test files that do.
 *
 * Filters (`eq`/`is`/`in`/`gt`/`lt`/`gte`/`lte`) actually filter the seeded
 * rows, so tests can assert on realistic query results (e.g. per-league
 * discord channel filtering, notification-log dedup across two handler calls)
 * instead of returning one canned response regardless of arguments.
 *
 * `options.unique` reproduces Postgres unique-constraint rejections (error code
 * 23505) so idempotency guards that rely on the insert failing can be tested,
 * rather than only the happy path where the row simply is not there yet.
 *
 * `update(...)` accumulates filters and reports the affected rows through
 * `.select()`, so a compare-and-swap can be tested end to end -- including the
 * losing side, which sees no row back. `options.users` backs
 * `auth.admin.getUserById` for the email lookups that cannot go through
 * PostgREST.
 */

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>

export interface MockDb {
  [table: string]: Row[]
}

interface QueryResult {
  data: Row[]
  error: { message: string } | null
  count: number
}

function applyEq(rows: Row[], col: string, val: unknown): Row[] {
  return rows.filter((r) => r[col] === val)
}

function applyIs(rows: Row[], col: string, val: unknown): Row[] {
  return rows.filter((r) => (val === null ? r[col] === null : r[col] === val))
}

function applyIn(rows: Row[], col: string, vals: unknown[]): Row[] {
  return rows.filter((r) => vals.includes(r[col]))
}

function chain(rows: Row[]) {
  const result: QueryResult & Record<string, unknown> = {
    data: rows,
    error: null,
    count: rows.length,
    eq: (col: string, val: unknown) => chain(applyEq(rows, col, val)),
    is: (col: string, val: unknown) => chain(applyIs(rows, col, val)),
    in: (col: string, vals: unknown[]) => chain(applyIn(rows, col, vals)),
    gt: (col: string, val: string | number) => chain(rows.filter((r) => r[col] > val)),
    lt: (col: string, val: string | number) => chain(rows.filter((r) => r[col] < val)),
    gte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] >= val)),
    lte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] <= val)),
    order: () => chain(rows),
    limit: (n: number) => chain(rows.slice(0, n)),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  }
  return result
}

/**
 * An `update(...)` in progress: filters accumulate, and the patch is applied
 * once at the end -- when the builder is awaited, or when `.select()` asks for
 * the affected rows back.
 *
 * Deferring the write is what lets a check-and-set
 * (`.eq('id', x).eq('status', 'active').select().maybeSingle()`) behave the way
 * Postgres does: the second filter narrows the same statement rather than
 * running a second update. `.select()` returning no row is how a caller learns
 * its compare-and-swap lost.
 */
type UpdateFilter = ['eq', string, unknown] | ['in', string, unknown[]]

function updateChain(rows: Row[], patch: Row, filters: UpdateFilter[]) {
  const apply = (): Row[] => {
    const matched = filters.reduce(
      (acc, filter) =>
        filter[0] === 'eq'
          ? applyEq(acc, filter[1], filter[2])
          : applyIn(acc, filter[1], filter[2] as unknown[]),
      rows
    )
    for (const row of matched) Object.assign(row, patch)
    return matched
  }

  return {
    eq: (col: string, val: unknown) => updateChain(rows, patch, [...filters, ['eq', col, val]]),
    in: (col: string, vals: unknown[]) => updateChain(rows, patch, [...filters, ['in', col, vals]]),
    select: (_cols?: string) => {
      const matched = apply()
      return {
        single: () =>
          Promise.resolve(
            matched.length > 0
              ? { data: matched[0], error: null }
              : { data: null, error: { code: 'PGRST116', message: 'no rows returned' } }
          ),
        maybeSingle: () => Promise.resolve({ data: matched[0] ?? null, error: null }),
        // Awaiting `.select()` without a row modifier yields every affected
        // row, which is how callers count what an update actually touched.
        then: (
          resolve: (value: { data: Row[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) => Promise.resolve({ data: matched, error: null }).then(resolve, reject),
      }
    },
    // Thenable so `await client.from(t).update(p).eq(c, v)` still resolves the
    // way it did before `.select()` existed here.
    then: (
      resolve: (value: { data: null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      apply()
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    },
  }
}

export interface FetchCall {
  url: string
  body: Record<string, unknown>
}

/**
 * Records every request made through `globalThis.fetch` and answers it,
 * returning the recorded calls and a restore function.
 *
 * Stubs the global rather than an injected fetchImpl because
 * sendDiscordNotification's webhook POST always goes through the real global
 * fetch -- without this, the Discord branch of every handler would hit the
 * network. `respond` handles URLs a test cares about (e.g. TMDb); anything it
 * returns undefined for answers 204, like a successful webhook delivery.
 */
export function stubFetch(respond?: (url: string) => Response | undefined): {
  calls: FetchCall[]
  restore: () => void
} {
  const calls: FetchCall[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : {} })
    return Promise.resolve(respond?.(url) ?? new Response(null, { status: 204 }))
  }) as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

export interface MockClientOptions {
  /**
   * Values (or factories) returned by `client.rpc(name)`. A factory receives the
   * call's arguments, so a test can vary the answer per league.
   */
  rpc?: Record<string, unknown | ((args?: Row) => unknown)>
  /** Columns forming a unique key per table, e.g. `{ foo: ['a', 'b'] }`. */
  unique?: Record<string, string[]>
  /** Auth users by id, for `auth.admin.getUserById` (email lookups). */
  users?: Record<string, { email?: string }>
}

/** Creates a mock Supabase client backed by `db`, mutated in place by inserts/updates. */
export function createMockDbClient(db: MockDb, options: MockClientOptions = {}) {
  return {
    rpc(name: string, args?: Row) {
      const entry = options.rpc?.[name]
      const value = typeof entry === 'function' ? (entry as (a?: Row) => unknown)(args) : entry
      return Promise.resolve({ data: value ?? null, error: null })
    },
    from(table: string) {
      if (!db[table]) db[table] = []
      return {
        select: (_cols?: string, _opts?: { count?: string; head?: boolean }) => chain(db[table]),
        insert: (rowsToInsert: Row | Row[]) => {
          const arr = Array.isArray(rowsToInsert) ? rowsToInsert : [rowsToInsert]
          const uniqueCols = options.unique?.[table]
          if (uniqueCols) {
            const clash = arr.some((candidate) =>
              db[table].some((existing) => uniqueCols.every((col) => existing[col] === candidate[col]))
            )
            if (clash) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: `duplicate key value violates unique constraint on ${table}`,
                },
              })
            }
          }
          db[table].push(...arr)
          return Promise.resolve({ data: arr, error: null })
        },
        update: (patch: Row) => updateChain(db[table], patch, []),
      }
    },
    auth: {
      admin: {
        /**
         * `auth.users` is not reachable through PostgREST, so email lookups go
         * through the admin API. Seeded from `options.users`; an unknown id
         * answers with no user, the way a deleted account would.
         */
        getUserById: (userId: string) =>
          Promise.resolve({
            data: { user: options.users?.[userId] ? { id: userId, ...options.users[userId] } : null },
            error: null,
          }),
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any
}
