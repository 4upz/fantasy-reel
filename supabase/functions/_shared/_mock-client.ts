/**
 * Shared in-memory mock Supabase client for unit-testing the scheduled
 * notification Edge Functions (release-day-announcements,
 * weekly-releases-digest, sync-release-dates, send-announcement,
 * bid-cutoff-announcement) and ingest-film-corpus.
 *
 * Not a test file itself (no `.test.ts` suffix), so `deno task test:unit`
 * does not execute it directly -- it's imported by the test files that do.
 *
 * Filters (`eq`/`is`/`in`/`gt`/`gte`/`lt`/`lte`) actually filter the seeded rows,
 * so tests can assert on realistic query results (e.g. per-league discord
 * channel filtering, notification-log dedup across two handler calls)
 * instead of returning one canned response regardless of arguments.
 *
 * `options.unique` reproduces Postgres unique-constraint rejections (error code
 * 23505) so idempotency guards that rely on the insert failing can be tested,
 * rather than only the happy path where the row simply is not there yet.
 */

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

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
    // Guarded against null explicitly: `null < 'anything'` is true in JS but
    // NULL never satisfies a comparison in Postgres.
    lt: (col: string, val: string | number) => chain(rows.filter((r) => r[col] != null && r[col] < val)),
    gte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] >= val)),
    lte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] <= val)),
    neq: (col: string, val: unknown) => chain(rows.filter((r) => r[col] !== val)),
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) return chain(rows.filter((r) => r[col] !== null && r[col] !== undefined))
      throw new Error(`mock not() supports only ('col', 'is', null); got ${op}`)
    },
    order: () => chain(rows),
    limit: (n: number) => chain(rows.slice(0, n)),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  }
  return result
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
        upsert: (rowsToUpsert: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
          const arr = Array.isArray(rowsToUpsert) ? rowsToUpsert : [rowsToUpsert]
          const keyCols = opts.onConflict ? opts.onConflict.split(',').map((c) => c.trim()) : options.unique?.[table]
          if (!keyCols) throw new Error(`mock upsert on ${table} needs onConflict or options.unique`)
          for (const candidate of arr) {
            const existing = db[table].find((row) => keyCols.every((col) => row[col] === candidate[col]))
            if (!existing) db[table].push({ ...candidate })
            else if (!opts.ignoreDuplicates) Object.assign(existing, candidate)
          }
          return Promise.resolve({ data: arr, error: null })
        },
        update: (patch: Row) => {
          // Chainable + thenable: eq/is/in each add an AND-ed predicate and
          // return the same builder, so `.update(p).eq(a, 1).is(b, null)`
          // matches rows satisfying both -- and a single call like
          // `.update(p).eq(a, 1)` still works because the builder itself is
          // awaitable (has `.then`), same as a real PostgREST query builder.
          const preds: Array<(row: Row) => boolean> = []
          const builder = {
            eq: (col: string, val: unknown) => {
              preds.push((r) => r[col] === val)
              return builder
            },
            is: (col: string, val: unknown) => {
              preds.push((r) => (val === null ? r[col] == null : r[col] === val))
              return builder
            },
            in: (col: string, vals: unknown[]) => {
              preds.push((r) => vals.includes(r[col]))
              return builder
            },
            then: <TResult1 = { data: null; error: null }, TResult2 = never>(
              onFulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
              onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ) => {
              for (const row of db[table]) if (preds.every((p) => p(row))) Object.assign(row, patch)
              return Promise.resolve({ data: null, error: null } as const).then(onFulfilled, onRejected)
            },
          }
          return builder
        },
      }
    },
    // deno-lint-ignore no-explicit-any
  } as any
}
