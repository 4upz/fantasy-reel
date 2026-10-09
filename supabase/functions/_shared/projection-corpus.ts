/**
 * Reads the projection model's inputs (`film_corpus` / `film_credits`) out of
 * Supabase or an export, as `CorpusFilm` / `CorpusCredit`.
 *
 * Shared by the fit-projection-model cron and scripts/backtest-projections.ts
 * so the model is fitted and backtested on identically shaped rows. Service
 * role only: both tables have no client policies.
 */

import type { CorpusCredit, CorpusFilm } from './projection-types.ts'

/** The `film_corpus` columns `CorpusFilm` maps. */
export const FILM_COLUMNS = [
  'tmdb_id',
  'title',
  'release_date',
  'us_wide_date',
  'us_limited_date',
  'us_digital_date',
  'effective_release_date',
  'us_release_type',
  'collection_id',
  'genre_ids',
  'company_ids',
  'label_id',
  'festival_premiere',
  'keyword_flags',
  'original_language',
  'budget',
  'runtime',
  'certification',
  'rt_critic',
  'rt_critic_votes',
  'rt_settled_at',
] as const

export const CREDIT_COLUMNS = 'tmdb_id,tmdb_person_id,role,billing'

const toNumber = (v: unknown) => (v == null || v === '' ? null : Number(v))
const toText = (v: unknown) => (v == null ? null : String(v))
const toList = <T>(v: unknown, map: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map(map) : [])

/** Coerces an exported or selected row to `CorpusFilm`, tolerating missing optional columns. */
export function normalizeFilm(row: Record<string, unknown>): CorpusFilm {
  return {
    tmdb_id: Number(row.tmdb_id),
    title: String(row.title ?? ''),
    release_date: toText(row.release_date),
    us_wide_date: toText(row.us_wide_date),
    us_limited_date: toText(row.us_limited_date),
    // Optional on CorpusFilm: carried only when the source has the column.
    ...('us_digital_date' in row && { us_digital_date: toText(row.us_digital_date) }),
    ...('effective_release_date' in row && { effective_release_date: toText(row.effective_release_date) }),
    us_release_type: toNumber(row.us_release_type),
    collection_id: toNumber(row.collection_id),
    genre_ids: toList(row.genre_ids, Number),
    company_ids: toList(row.company_ids, Number),
    label_id: toText(row.label_id),
    festival_premiere: toText(row.festival_premiere),
    keyword_flags: toList(row.keyword_flags, String),
    original_language: toText(row.original_language),
    budget: toNumber(row.budget),
    runtime: toNumber(row.runtime),
    certification: toText(row.certification),
    rt_critic: toNumber(row.rt_critic),
    rt_critic_votes: toNumber(row.rt_critic_votes),
    rt_settled_at: toText(row.rt_settled_at),
  }
}

export function normalizeCredit(row: Record<string, unknown>): CorpusCredit {
  const role = String(row.role)
  if (role !== 'director' && role !== 'writer' && role !== 'cast') throw new Error(`unknown credit role: ${role}`)
  return {
    tmdb_id: Number(row.tmdb_id),
    tmdb_person_id: Number(row.tmdb_person_id),
    role,
    billing: toNumber(row.billing),
  }
}

type PageResult = { data: unknown[] | null; error: { message: string } | null }

/** A select that can be filtered, ordered and paged; what `selectAll` drives. */
export interface PagedQuery {
  gte(column: string, value: unknown): PagedQuery
  is(column: string, value: null): PagedQuery
  order(column: string): PagedQuery
  range(from: number, to: number): PromiseLike<PageResult>
}

/**
 * Structural client slice so this module needs no esm.sh type import. A real
 * SupabaseClient satisfies it at runtime; pass it through `asCorpusClient`
 * (supabase-js's generic builders trip TS2589 against a narrow type).
 */
export interface CorpusClient {
  from(table: string): { select(columns: string): PagedQuery }
}

export function asCorpusClient(client: { from: unknown }): CorpusClient {
  return client as unknown as CorpusClient
}

/** PostgREST's max_rows: a page shorter than this is the last. */
export const PAGE_SIZE = 1000

/**
 * Every row of a select, a page at a time. `order` must form a unique key, or
 * rows can repeat or vanish across page boundaries. `build` narrows the
 * select (filters) before ordering and paging.
 */
export async function selectAll(
  client: CorpusClient,
  table: string,
  columns: string,
  order: readonly string[],
  build: (query: PagedQuery) => PagedQuery = (query) => query,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0;; from += PAGE_SIZE) {
    let query = build(client.from(table).select(columns))
    for (const column of order) query = query.order(column)
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = (data ?? []) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

/** The whole corpus: every film and credit, paged. */
export async function loadCorpus(client: CorpusClient): Promise<{ films: CorpusFilm[]; credits: CorpusCredit[] }> {
  const [films, credits] = await Promise.all([
    selectAll(client, 'film_corpus', FILM_COLUMNS.join(','), ['tmdb_id']),
    selectAll(client, 'film_credits', CREDIT_COLUMNS, ['tmdb_id', 'tmdb_person_id', 'role']),
  ])
  return { films: films.map(normalizeFilm), credits: credits.map(normalizeCredit) }
}
