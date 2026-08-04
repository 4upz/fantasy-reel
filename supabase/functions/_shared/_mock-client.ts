/**
 * Shared in-memory mock Supabase client for unit-testing the Epic C
 * scheduled-notification Edge Functions (release-day-announcements,
 * weekly-releases-digest, sync-release-dates, send-announcement).
 *
 * Not a test file itself (no `.test.ts` suffix), so `deno task test:unit`
 * does not execute it directly -- it's imported by the test files that do.
 *
 * Filters (`eq`/`is`/`in`/`gt`/`gte`/`lte`) actually filter the seeded rows,
 * so tests can assert on realistic query results (e.g. per-league discord
 * channel filtering, notification-log dedup across two handler calls)
 * instead of returning one canned response regardless of arguments.
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
    gte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] >= val)),
    lte: (col: string, val: string | number) => chain(rows.filter((r) => r[col] <= val)),
    order: () => chain(rows),
    limit: (n: number) => chain(rows.slice(0, n)),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  }
  return result
}

/** Creates a mock Supabase client backed by `db`, mutated in place by inserts/updates. */
export function createMockDbClient(db: MockDb) {
  return {
    from(table: string) {
      if (!db[table]) db[table] = []
      return {
        select: (_cols?: string, _opts?: { count?: string; head?: boolean }) => chain(db[table]),
        insert: (rowsToInsert: Row | Row[]) => {
          const arr = Array.isArray(rowsToInsert) ? rowsToInsert : [rowsToInsert]
          db[table].push(...arr)
          return Promise.resolve({ data: arr, error: null })
        },
        update: (patch: Row) => ({
          eq: (col: string, val: unknown) => {
            for (const row of db[table]) {
              if (row[col] === val) Object.assign(row, patch)
            }
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    },
    // deno-lint-ignore no-explicit-any
  } as any
}
