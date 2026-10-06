#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
/**
 * Backtests the projection model and writes the ship-gate report.
 *
 * Usage:
 *   # From a corpus export: JSON {"films": [...], "credits": [...]}, or NDJSON
 *   # with one film_corpus or film_credits row per line
 *   deno run -A scripts/backtest-projections.ts --input corpus.json
 *
 *   # Straight from Supabase (read-only selects on film_corpus / film_credits),
 *   # using SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   deno run -A scripts/backtest-projections.ts --supabase
 *
 *   # Synthetic fixture corpus: tests the script end to end, approves nothing
 *   deno run -A scripts/backtest-projections.ts --synthetic
 *
 * Options:
 *   --out <path>          Report path (default docs/projections/backtest-<date>.md;
 *                         synthetic runs default to a temp file)
 *   --json <path>         Also write the summary (gates, per-year, pooled) as JSON
 *   --first-year <Y>      First test year (default 2019)
 *   --last-year <Y>       Last complete year (default last calendar year)
 *   --model-version <N>   The projection_models version this report approves
 *   --no-gbm              Skip the gradient-boosted challenger
 *   --strict              Exit 1 when the gate fails
 *   --films-per-year <N>  Synthetic corpus size (default 200)
 *   --seed <N>            Synthetic corpus seed (default 42)
 */

import { parseArgs } from 'jsr:@std/cli@^1.0.0/parse-args'
import { syntheticCorpus } from '../supabase/functions/_shared/projection-synthetic.ts'
import type { CorpusCredit, CorpusFilm } from '../supabase/functions/_shared/projection-types.ts'
import { type BacktestResult, renderReport, runBacktest } from './projections/backtest.ts'

export interface Corpus {
  films: CorpusFilm[]
  credits: CorpusCredit[]
}

const FILM_COLUMNS = [
  'tmdb_id',
  'title',
  'release_date',
  'us_wide_date',
  'us_limited_date',
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

const toNumber = (v: unknown) => (v == null || v === '' ? null : Number(v))
const toText = (v: unknown) => (v == null ? null : String(v))

/** Coerces an exported or selected row to `CorpusFilm`, tolerating missing optional columns. */
export function normalizeFilm(row: Record<string, unknown>): CorpusFilm {
  return {
    tmdb_id: Number(row.tmdb_id),
    title: String(row.title ?? ''),
    release_date: toText(row.release_date),
    us_wide_date: toText(row.us_wide_date),
    us_limited_date: toText(row.us_limited_date),
    us_release_type: toNumber(row.us_release_type),
    collection_id: toNumber(row.collection_id),
    genre_ids: Array.isArray(row.genre_ids) ? row.genre_ids.map(Number) : [],
    company_ids: Array.isArray(row.company_ids) ? row.company_ids.map(Number) : [],
    label_id: toText(row.label_id),
    festival_premiere: toText(row.festival_premiere),
    keyword_flags: Array.isArray(row.keyword_flags) ? row.keyword_flags.map(String) : [],
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

/** Parses a JSON {films, credits} export, or NDJSON rows (credits are the rows with tmdb_person_id). */
export function parseCorpus(text: string, path: string): Corpus {
  if (path.endsWith('.ndjson') || path.endsWith('.jsonl')) {
    const corpus: Corpus = { films: [], credits: [] }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line) as Record<string, unknown>
      if ('tmdb_person_id' in row) corpus.credits.push(normalizeCredit(row))
      else corpus.films.push(normalizeFilm(row))
    }
    return corpus
  }
  const parsed = JSON.parse(text) as { films?: Record<string, unknown>[]; credits?: Record<string, unknown>[] }
  if (!Array.isArray(parsed.films)) throw new Error(`${path}: expected {"films": [...], "credits": [...]}`)
  return { films: parsed.films.map(normalizeFilm), credits: (parsed.credits ?? []).map(normalizeCredit) }
}

/** Reads the corpus from Supabase with the service role: paged, read-only selects. */
async function loadFromSupabase(): Promise<Corpus> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('--supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const page = 1000
  const all = async (table: string, columns: string, order: string[]) => {
    const rows: Record<string, unknown>[] = []
    for (let from = 0;; from += page) {
      let query = client.from(table).select(columns)
      for (const column of order) query = query.order(column)
      const { data, error } = await query.range(from, from + page - 1)
      if (error) throw new Error(`${table}: ${error.message}`)
      rows.push(...(data as unknown as Record<string, unknown>[]))
      if (!data || data.length < page) return rows
    }
  }
  const films = await all('film_corpus', FILM_COLUMNS.join(','), ['tmdb_id'])
  const credits = await all('film_credits', 'tmdb_id,tmdb_person_id,role,billing', ['tmdb_id', 'tmdb_person_id', 'role'])
  return { films: films.map(normalizeFilm), credits: credits.map(normalizeCredit) }
}

/** The JSON summary: everything but the per-film records and the model. */
export function summaryJson(result: BacktestResult): Record<string, unknown> {
  const { records: _records, latest_model: _model, ...summary } = result
  return summary
}

export async function main(argv: string[]): Promise<{ result: BacktestResult; reportPath: string; exitCode: number }> {
  const args = parseArgs(argv, {
    string: ['input', 'out', 'json', 'first-year', 'last-year', 'model-version', 'films-per-year', 'seed'],
    boolean: ['supabase', 'synthetic', 'no-gbm', 'strict', 'help'],
    alias: { h: 'help', i: 'input', o: 'out' },
  })
  const sources = [args.input != null, args.supabase, args.synthetic].filter(Boolean).length
  if (args.help || sources !== 1) {
    console.log('Usage: backtest-projections.ts (--input <file> | --supabase | --synthetic) [--out <path>] [--json <path>] [--strict]')
    if (!args.help) throw new Error('choose exactly one of --input, --supabase, --synthetic')
    return { result: null as unknown as BacktestResult, reportPath: '', exitCode: 0 }
  }

  let corpus: Corpus
  let source: string
  if (args.synthetic) {
    const filmsPerYear = Number(args['films-per-year'] ?? 200)
    const seed = Number(args.seed ?? 42)
    corpus = syntheticCorpus({ filmsPerYear, seed, lastYear: 2025 })
    source = `synthetic fixture (seed ${seed}, ${filmsPerYear} films/year, 2012–2025)`
  } else if (args.supabase) {
    corpus = await loadFromSupabase()
    source = 'Supabase film_corpus / film_credits (service role, read-only)'
  } else {
    corpus = parseCorpus(await Deno.readTextFile(args.input!), args.input!)
    source = `file ${args.input}`
  }

  const now = new Date()
  const result = runBacktest(corpus, {
    now,
    firstTestYear: args['first-year'] ? Number(args['first-year']) : undefined,
    lastCompleteYear: args['last-year'] ? Number(args['last-year']) : args.synthetic ? 2025 : undefined,
    gbm: args['no-gbm'] ? false : undefined,
  })
  const date = now.toISOString().slice(0, 10)
  const reportPath = args.out ??
    (args.synthetic
      ? `${await Deno.makeTempDir({ prefix: 'projection-backtest-' })}/backtest-${date}-synthetic.md`
      : `docs/projections/backtest-${date}.md`)
  const report = renderReport(result, {
    source,
    synthetic: args.synthetic,
    modelVersion: args['model-version'] ? Number(args['model-version']) : null,
  })
  const directory = reportPath.includes('/') ? reportPath.slice(0, reportPath.lastIndexOf('/')) : '.'
  await Deno.mkdir(directory, { recursive: true })
  await Deno.writeTextFile(reportPath, report)
  if (args.json) await Deno.writeTextFile(args.json, JSON.stringify(summaryJson(result), null, 2))

  console.log(`Gate: ${result.passed ? 'PASS' : 'FAIL'}`)
  for (const gate of result.gates) console.log(`  ${gate.pass ? 'PASS' : 'FAIL'}  ${gate.check}: ${gate.value}`)
  console.log(`Report: ${reportPath}`)
  return { result, reportPath, exitCode: args.strict && !result.passed ? 1 : 0 }
}

if (import.meta.main) {
  try {
    const { exitCode } = await main(Deno.args)
    Deno.exit(exitCode)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    Deno.exit(2)
  }
}
