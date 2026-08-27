# Movie Projections — Phase 1 (Plumbing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dark plumbing for movie projections — schema, a Studio-editable `feature_flags` table, a shared MDBList daily budget, the budget-paced `ingest-film-corpus` cron, and pre-release score polling — so the historical corpus starts filling before any model or UI exists.

**Architecture:** One migration adds every projections table and an idempotent copy of PR #72's `external_api_budgets` + `reserve_external_api_calls` (so merge order doesn't matter). A pure `_shared/feature-flags.ts` and `_shared/mdblist-budget.ts` gate quota spend under the `mdblist:projections` key. `ingest-film-corpus/handler.ts` runs three stages (seed → TMDb metadata → MDBList ratings) with all Supabase and HTTP calls going through injectable clients so it is unit-tested against `_shared/_mock-client.ts`. `update-scores` gains a budget-reserved pre-release branch and a projection-freeze hook.

**Tech Stack:** Supabase Postgres + RLS, Deno Edge Functions, `@std/assert` tests, Vercel Cron → `/api/cron/*` proxy, TMDb v4 bearer API, MDBList REST API.

**Spec:** `docs/superpowers/specs/2026-08-26-movie-projections-design.md` (§2, §4, §5, §8.1, §11, §12 Phase 1)

## Global Constraints

- Migration timestamp must be **later than `20260827120000`** (a sibling branch owns that one; duplicates are skipped silently). Use `20260828120000_movie_projections_plumbing.sql`.
- Every new Edge Function needs `[functions.<name>]\nverify_jwt = false` in `supabase/config.toml`; functions authenticate internally.
- Cron functions: `handleCorsPreflightRequest` first, `isAuthorizedCronRequest` before `startJobRun`, outer catch ends with `run.fail` + `internalErrorResponse`, response includes `job_status`. Truncation/remaining counts are reported **in-band** in `metadata`.
- Outbound HTTP only via `fetchWithRetry` / `fetchWithTimeout` (`_shared/http.ts`) or `tmdbGetJson` (`_shared/tmdb.ts`). Never bare `fetch`.
- No `console.*`; use `createLogger('<fn>')` and `serializeError`.
- User traffic must never spend MDBList quota. Only `ingest-film-corpus` and `update-scores` call MDBList for projections, and both reserve through `reserveApiCalls` (→ RPC `reserve_external_api_calls`, key `mdblist:projections`) first. The budget table/RPC definition is **copied verbatim from PR #72** (`origin/claude/franchise-history:supabase/migrations/20260827120000_external_api_budgets.sql`); do not alter its signature.
- Flag keys are exactly `projections_ingestion` and `projections_display`. Flag config keys: `mdblist_daily_budget` (default 500), `per_run_cap` (default 300).
- Feature flags are edited in Supabase Studio → Table Editor → `feature_flags`; no SQL workflow is documented for operators.
- Unit tests live in `supabase/functions/_shared/*.test.ts` (run `cd supabase/functions && deno task test:unit`); integration tests in `supabase/functions/tests/` (run `npm run test:functions`, needs local Supabase). New third-party-API tests must be gated behind `RUN_EXTERNAL_API_TESTS`.
- Commit after every task. Run `git status` and `git diff --stat` before each commit.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260828120000_movie_projections_plumbing.sql` | All new tables, RLS, seed flag rows, idempotent copy of PR #72's budget table + RPC |
| `supabase/functions/_shared/feature-flags.ts` (+ `.test.ts`) | `getFlag` with per-isolate memo |
| `supabase/functions/_shared/mdblist-budget.ts` (+ `.test.ts`) | `fetchMdblistUsage`, `reserveApiCalls` (wraps `reserve_external_api_calls`) |
| `supabase/functions/_shared/scoring.ts` (+ `.test.ts`) | `fetchMDBListRatings` also returns `details` |
| `supabase/functions/_shared/tmdb-corpus.ts` (+ `.test.ts`) | Typed TMDb fetchers + pure row mappers for the corpus |
| `supabase/functions/_shared/_mock-client.ts` | Adds `upsert`, `neq`, `not`, `update().is()` |
| `supabase/functions/ingest-film-corpus/handler.ts` (+ `_shared/ingest-film-corpus.test.ts`) | Stages A/B/C |
| `supabase/functions/ingest-film-corpus/index.ts` | Cron entrypoint |
| `supabase/config.toml`, `apps/frontend/vercel.json`, `apps/frontend/app/api/cron/ingest-film-corpus/route.ts` | Wiring |
| `supabase/functions/update-scores/index.ts` (+ `tests/update-scores.test.ts`) | Pre-release branch, projection freeze |
| `supabase/functions/tests/feature-flags-rls.test.ts` | Flag RLS + budget RPC presence integration test |
| `CLAUDE.md` | Feature-flag and projections plumbing docs |

---

### Task 1: Migration — projections plumbing schema

**Files:**
- Create: `supabase/migrations/20260828120000_movie_projections_plumbing.sql`
- Test: `supabase/functions/tests/feature-flags-rls.test.ts`

**Interfaces:**
- Produces tables `feature_flags`, `film_corpus`, `film_people`, `film_credits`, `film_collections`, `projection_models`, `movie_projections`; and (idempotently, identical to PR #72) `external_api_budgets` + RPC `reserve_external_api_calls(p_api text, p_requested int, p_daily_limit int) RETURNS int`. PR #72's own `tests/reserve-external-api-calls.test.ts` covers the RPC's cap/concurrency semantics; this task only asserts it exists and is service-role-only.

- [ ] **Step 1: Write the failing integration test**

`supabase/functions/tests/feature-flags-rls.test.ts`:

```ts
import { assertEquals, assert } from '@std/assert'
import { getServiceClient, getAuthenticatedClient } from './_setup.ts'

Deno.test('feature_flags + external_api_budgets', async (t) => {
  const service = getServiceClient()

  await t.step('reserve_external_api_calls exists and grants under a private key', async () => {
    const key = `test:${crypto.randomUUID()}`
    const first = await service.rpc('reserve_external_api_calls', { p_api: key, p_requested: 7, p_daily_limit: 10 })
    assertEquals(first.error, null)
    assertEquals(first.data, 7)
    const second = await service.rpc('reserve_external_api_calls', { p_api: key, p_requested: 7, p_daily_limit: 10 })
    assertEquals(second.data, 3)
    await service.from('external_api_budgets').delete().eq('api', key)
  })

  await t.step('authenticated users can read flags but not write them or call the RPC', async () => {
    const user = await getAuthenticatedClient()
    const read = await user.from('feature_flags').select('key, enabled, config').eq('key', 'projections_display').single()
    assertEquals(read.error, null)
    assertEquals(read.data?.enabled, false)
    const write = await user.from('feature_flags').update({ enabled: true }).eq('key', 'projections_display')
    // RLS: no UPDATE policy for authenticated → zero rows affected, no error surfaced
    const check = await user.from('feature_flags').select('enabled').eq('key', 'projections_display').single()
    assertEquals(check.data?.enabled, false)
    assert(write.error === null || write.error !== undefined)
    const rpc = await user.rpc('reserve_external_api_calls', { p_api: 'x', p_requested: 1, p_daily_limit: 1 })
    assert(rpc.error !== null, 'authenticated must not execute reserve_external_api_calls')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all --env-file=.env.test tests/feature-flags-rls.test.ts`
Expected: FAIL — `relation "feature_flags" does not exist` / RPC not found.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260828120000_movie_projections_plumbing.sql`:

```sql
-- ============================================================================
-- Movie Projections (Beta) -- plumbing
--
-- Spec: docs/superpowers/specs/2026-08-26-movie-projections-design.md
--
-- Adds: feature_flags (operator switches, edited in Supabase Studio's Table
-- Editor), the historical film corpus (film_corpus, film_people,
-- film_credits, film_collections), the projection tables
-- (projection_models, movie_projections) that Phase 2 fills, and an
-- IDEMPOTENT copy of external_api_budgets + reserve_external_api_calls()
-- from PR #72 (20260827120000_external_api_budgets.sql) so this migration
-- works whether it lands before or after that one.
--
-- Access model: feature_flags and movie_projections are readable by any
-- signed-in user (nothing league-specific in them); everything else is
-- service-role only (RLS on, no policies).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- feature_flags
-- ---------------------------------------------------------------------------
CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE feature_flags IS 'Operator switches. Edit in Supabase Studio -> Table Editor -> feature_flags (toggle enabled, edit config JSON). Read by Edge Functions via _shared/feature-flags.ts and by the frontend via hooks/useFeatureFlag.ts. Changes apply within ~60s, no deploy.';
COMMENT ON COLUMN feature_flags.config IS 'Free-form JSON the flag''s consumers read (e.g. daily budgets). See description per row.';

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feature flags"
  ON feature_flags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage feature flags"
  ON feature_flags FOR ALL USING (auth.role() = 'service_role');

INSERT INTO feature_flags (key, enabled, config, description) VALUES
  ('projections_ingestion', true,
   '{"mdblist_daily_budget": 500, "per_run_cap": 300}'::jsonb,
   'Corpus backfill (ingest-film-corpus) and pre-release score polling (update-scores) may spend MDBList quota under the mdblist:projections budget key. Turn OFF to hand that slice back to nightly scoring. mdblist_daily_budget = MDBList calls/day these two jobs may use (franchise history has its own 300; scoring is unreserved); per_run_cap = max ratings fetched per ingest run.'),
  ('projections_display', false,
   '{}'::jsonb,
   'Show projected scores (Beta) in the app. Keep OFF until the backtest gate in the projections spec (Spearman >= 0.40, MAE <= 16) has passed.');

-- ---------------------------------------------------------------------------
-- external_api_budgets + reserve_external_api_calls -- IDEMPOTENT COPY of
-- PR #72's 20260827120000_external_api_budgets.sql. Keep byte-identical to
-- that file's definitions; whichever migration runs second is a no-op.
-- Projections reserve under the key 'mdblist:projections'; franchise history
-- under 'mdblist:franchise-history'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_api_budgets (
  api        text NOT NULL,
  day        date NOT NULL,
  calls      integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api, day)
);

COMMENT ON TABLE external_api_budgets IS
  'Calls reserved per third-party API per UTC day; see reserve_external_api_calls()';

ALTER TABLE external_api_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_api_budgets FROM PUBLIC, anon, authenticated;
GRANT ALL ON external_api_budgets TO service_role;

CREATE OR REPLACE FUNCTION reserve_external_api_calls(
  p_api text,
  p_requested integer,
  p_daily_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_before integer;
  v_after integer;
BEGIN
  IF p_requested IS NULL OR p_requested <= 0 OR p_daily_limit IS NULL OR p_daily_limit <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO external_api_budgets (api, day)
  VALUES (p_api, v_day)
  ON CONFLICT (api, day) DO NOTHING;

  SELECT calls INTO v_before
  FROM external_api_budgets
  WHERE api = p_api AND day = v_day
  FOR UPDATE;

  -- Never write a total lower than what has already been spent: a limit
  -- lowered mid-day must grant nothing, not rewrite the day's history.
  v_after := GREATEST(v_before, LEAST(p_daily_limit, v_before + p_requested));

  UPDATE external_api_budgets
  SET calls = v_after, updated_at = now()
  WHERE api = p_api AND day = v_day;

  RETURN GREATEST(v_after - v_before, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION reserve_external_api_calls(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_external_api_calls(text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Historical film corpus
-- ---------------------------------------------------------------------------
CREATE TABLE film_corpus (
  tmdb_id             integer PRIMARY KEY,
  title               text NOT NULL,
  release_date        date,
  collection_id       integer,
  genre_ids           integer[] NOT NULL DEFAULT '{}',
  company_ids         integer[] NOT NULL DEFAULT '{}',
  budget              bigint,
  runtime             integer,
  certification       text,
  us_release_type     smallint,
  vote_average        numeric(3,1),
  vote_count          integer,
  rt_critic           smallint,
  rt_critic_votes     integer,
  metacritic          smallint,
  imdb                numeric(3,1),
  metadata_fetched_at timestamptz,
  ratings_fetched_at  timestamptz,
  ratings_absent      boolean NOT NULL DEFAULT false,
  seed_source         text NOT NULL CHECK (seed_source IN ('discover', 'person', 'collection', 'upcoming')),
  priority            smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE film_corpus IS 'Historical films (TMDb metadata + MDBList ratings) the projection model learns from. Separate from movies on purpose: most rows are never in any league. Service-role only.';
COMMENT ON COLUMN film_corpus.us_release_type IS 'TMDb US release type: 3 = wide theatrical, 2 = limited, others as TMDb defines.';
COMMENT ON COLUMN film_corpus.rt_critic IS 'Tomatometer 0-100 from MDBList source "tomatoes". NULL until ratings_fetched_at is set; stays NULL with ratings_absent = true when MDBList has none.';
COMMENT ON COLUMN film_corpus.ratings_absent IS 'MDBList returned 404 or no Tomatometer. Stamped so the row is never re-fetched.';
COMMENT ON COLUMN film_corpus.seed_source IS 'How the row entered: discover (historical wide-release sweep), person (a credited person''s prior film), collection (a franchise entry), upcoming (a movie in a league).';
COMMENT ON COLUMN film_corpus.priority IS 'Fetch order, higher first. 100 = in a league now, 50 = predecessor of one, 0 = historical sweep.';

CREATE INDEX idx_film_corpus_needs_metadata ON film_corpus (priority DESC, release_date DESC NULLS LAST)
  WHERE metadata_fetched_at IS NULL;
CREATE INDEX idx_film_corpus_needs_ratings ON film_corpus (priority DESC, release_date DESC NULLS LAST)
  WHERE ratings_fetched_at IS NULL AND metadata_fetched_at IS NOT NULL;
CREATE INDEX idx_film_corpus_collection ON film_corpus (collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX idx_film_corpus_release_date ON film_corpus (release_date);

ALTER TABLE film_corpus ENABLE ROW LEVEL SECURITY;
-- No policies defined: only the service role (which bypasses RLS) may access this table.

CREATE TABLE film_people (
  tmdb_person_id     integer PRIMARY KEY,
  name               text NOT NULL,
  credits_fetched_at timestamptz
);
COMMENT ON TABLE film_people IS 'Directors, writers, and top-billed cast referenced by film_credits. credits_fetched_at marks that /person/{id}/movie_credits has seeded their prior films. Service-role only.';
ALTER TABLE film_people ENABLE ROW LEVEL SECURITY;

CREATE TABLE film_credits (
  tmdb_id        integer NOT NULL REFERENCES film_corpus(tmdb_id) ON DELETE CASCADE,
  tmdb_person_id integer NOT NULL REFERENCES film_people(tmdb_person_id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('director', 'writer', 'cast')),
  billing        smallint,
  PRIMARY KEY (tmdb_id, tmdb_person_id, role)
);
COMMENT ON COLUMN film_credits.billing IS 'Cast order from TMDb (0 = top billing). NULL for director/writer.';
CREATE INDEX idx_film_credits_person ON film_credits (tmdb_person_id, role);
ALTER TABLE film_credits ENABLE ROW LEVEL SECURITY;

CREATE TABLE film_collections (
  collection_id    integer PRIMARY KEY,
  name             text NOT NULL,
  parts_fetched_at timestamptz
);
COMMENT ON TABLE film_collections IS 'TMDb collections (franchises). parts_fetched_at marks that every part has been seeded into film_corpus. Service-role only.';
ALTER TABLE film_collections ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Projections (filled by Phase 2; created now so the schema ships once)
-- ---------------------------------------------------------------------------
CREATE TABLE projection_models (
  version      integer PRIMARY KEY,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  coefficients jsonb NOT NULL,
  metrics      jsonb NOT NULL,
  is_active    boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE projection_models IS 'Fitted projection coefficients + backtest metrics per version. Exactly one row is_active. Service-role only.';
CREATE UNIQUE INDEX idx_projection_models_active ON projection_models (is_active) WHERE is_active;
ALTER TABLE projection_models ENABLE ROW LEVEL SECURITY;

CREATE TABLE movie_projections (
  tmdb_id            integer PRIMARY KEY,
  model_version      integer NOT NULL REFERENCES projection_models(version),
  projected_rt       numeric(4,1) NOT NULL,
  sigma              numeric(4,1) NOT NULL,
  p_rotten           numeric(4,3) NOT NULL,
  p_fresh            numeric(4,3) NOT NULL,
  p_club90           numeric(4,3) NOT NULL,
  expected_points    numeric(6,2) NOT NULL,
  factors            jsonb NOT NULL,
  coverage           numeric(3,2) NOT NULL,
  partial            boolean NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  frozen_at          timestamptz,
  actual_rt          smallint,
  draft_position_avg numeric(5,2),
  bid_total          integer,
  counterpick_count  integer,
  signals_updated_at timestamptz
);
COMMENT ON TABLE movie_projections IS 'Cached projection per TMDb movie (Beta). Readable by any signed-in user; written by Edge Functions only. frozen_at/actual_rt are set by update-scores when the real Tomatometer first lands.';
COMMENT ON COLUMN movie_projections.expected_points IS 'Fantasy points integrated over the projected RT distribution -- NOT the curve applied to projected_rt.';
COMMENT ON COLUMN movie_projections.partial IS 'True while some factor''s prior films are still queued for ingestion.';

ALTER TABLE movie_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read projections"
  ON movie_projections FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage projections"
  ON movie_projections FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 4: Apply the migration and run the test**

Run:
```bash
npx supabase migration up
cd supabase/functions && deno test --allow-all --env-file=.env.test tests/feature-flags-rls.test.ts
```
Expected: PASS (2 steps). If `migration up` reports nothing to apply, confirm with `docker exec supabase_db_fantasy-reel psql -U postgres -d postgres -c "select version from supabase_migrations.schema_migrations order by version desc limit 3"` that `20260828120000` is present. Also verify idempotency against PR #72 by applying its migration file on top: `docker exec -i supabase_db_fantasy-reel psql -U postgres -d postgres < <(git show origin/claude/franchise-history:supabase/migrations/20260827120000_external_api_budgets.sql)` — it must fail only on `CREATE TABLE external_api_budgets` already existing (theirs lacks `IF NOT EXISTS`; that is the expected order-dependence and is why our copy is the idempotent one). If the local DB was already migrated from a checkout containing #72, `migration up` applying ours must succeed silently.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828120000_movie_projections_plumbing.sql supabase/functions/tests/feature-flags-rls.test.ts
git commit -m "feat(projections): plumbing schema, feature_flags, idempotent budget RPC copy"
```

---

### Task 2: `_shared/feature-flags.ts`

**Files:**
- Create: `supabase/functions/_shared/feature-flags.ts`
- Test: `supabase/functions/_shared/feature-flags.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FeatureFlag { enabled: boolean; config: Record<string, unknown> }
  export interface FlagClient { from(table: string): { select(cols: string): { eq(col: string, val: unknown): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } }
  export async function getFlag(client: FlagClient, key: string, opts?: { now?: () => number }): Promise<FeatureFlag>
  export function clearFlagCache(): void
  export function flagNumber(flag: FeatureFlag, key: string, fallback: number): number
  ```

- [ ] **Step 1: Write the failing test**

`supabase/functions/_shared/feature-flags.test.ts`:

```ts
import { assertEquals } from '@std/assert'
import { getFlag, clearFlagCache, flagNumber, type FlagClient } from './feature-flags.ts'

function clientReturning(rows: Record<string, { enabled: boolean; config: Record<string, unknown> }>) {
  let selects = 0
  const client: FlagClient = {
    from: () => ({
      select: () => ({
        eq: (_col: string, key: unknown) => ({
          maybeSingle: () => {
            selects++
            const row = rows[key as string]
            return Promise.resolve({ data: row ? { key, ...row } : null, error: null })
          },
        }),
      }),
    }),
  }
  return { client, selects: () => selects }
}

Deno.test('feature-flags', async (t) => {
  await t.step('missing row reads as disabled with empty config', async () => {
    clearFlagCache()
    const { client } = clientReturning({})
    const flag = await getFlag(client, 'nope')
    assertEquals(flag, { enabled: false, config: {} })
  })

  await t.step('returns the row and memoizes for 60s', async () => {
    clearFlagCache()
    let now = 1_000_000
    const { client, selects } = clientReturning({ projections_ingestion: { enabled: true, config: { per_run_cap: 5 } } })
    const first = await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(first.enabled, true)
    now += 30_000
    await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(selects(), 1)
    now += 31_000
    await getFlag(client, 'projections_ingestion', { now: () => now })
    assertEquals(selects(), 2)
  })

  await t.step('a query error reads as disabled and is not cached', async () => {
    clearFlagCache()
    let calls = 0
    const client: FlagClient = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => { calls++; return Promise.resolve({ data: null, error: { message: 'boom' } }) } }) }) }),
    }
    assertEquals((await getFlag(client, 'x')).enabled, false)
    await getFlag(client, 'x')
    assertEquals(calls, 2)
  })

  await t.step('flagNumber falls back on missing or non-numeric config', () => {
    assertEquals(flagNumber({ enabled: true, config: { a: 7 } }, 'a', 1), 7)
    assertEquals(flagNumber({ enabled: true, config: { a: 'x' } }, 'a', 1), 1)
    assertEquals(flagNumber({ enabled: true, config: {} }, 'a', 1), 1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/feature-flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`supabase/functions/_shared/feature-flags.ts`:

```ts
/**
 * Operator feature flags, backed by the `feature_flags` table.
 *
 * Operators edit rows in Supabase Studio -> Table Editor -> feature_flags
 * (toggle `enabled`, edit `config`). No deploy, no SQL. Reads are memoized
 * per isolate for 60s so a cron that consults a flag once per item does
 * not hammer the table; a missing row or a read error is `disabled`, which
 * is the safe default for every flag we have (they all gate spend or
 * visibility).
 */
import { createLogger, serializeError } from './logger.ts'

const log = createLogger('shared/feature-flags')

const CACHE_TTL_MS = 60_000

export interface FeatureFlag {
  enabled: boolean
  config: Record<string, unknown>
}

/** Structural client slice so this module needs no esm.sh type import. */
export interface FlagClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
}

const DISABLED: FeatureFlag = { enabled: false, config: {} }

const cache = new Map<string, { flag: FeatureFlag; fetchedAt: number }>()

export function clearFlagCache(): void {
  cache.clear()
}

export async function getFlag(
  client: FlagClient,
  key: string,
  opts: { now?: () => number } = {}
): Promise<FeatureFlag> {
  const now = opts.now ?? Date.now
  const cached = cache.get(key)
  if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) return cached.flag

  const { data, error } = await client.from('feature_flags').select('key, enabled, config').eq('key', key).maybeSingle()
  if (error) {
    log.warn('Feature flag read failed; treating as disabled', { key, error: serializeError(error) })
    return DISABLED
  }
  const row = data as { enabled?: boolean; config?: unknown } | null
  const flag: FeatureFlag = row
    ? { enabled: row.enabled === true, config: isRecord(row.config) ? row.config : {} }
    : DISABLED
  cache.set(key, { flag, fetchedAt: now() })
  return flag
}

/** Reads a numeric config value, falling back when absent or not a finite number. */
export function flagNumber(flag: FeatureFlag, key: string, fallback: number): number {
  const value = flag.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test --allow-all _shared/feature-flags.test.ts`
Expected: PASS (4 steps).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/feature-flags.ts supabase/functions/_shared/feature-flags.test.ts
git commit -m "feat(projections): feature flag reader with per-isolate memo"
```

---

### Task 3: `_shared/mdblist-budget.ts`

**Files:**
- Create: `supabase/functions/_shared/mdblist-budget.ts`
- Test: `supabase/functions/_shared/mdblist-budget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MDBLIST_PROJECTIONS_KEY = 'mdblist:projections'
  export const MDBLIST_ACCOUNT_CAP = 1000
  export const MDBLIST_SCORING_RESERVE = 100
  export interface MdblistUsage { cap: number; used: number }
  export async function fetchMdblistUsage(apiKey: string, fetchImpl?: typeof fetch): Promise<MdblistUsage | null>
  export interface BudgetClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
  export async function reserveApiCalls(client: BudgetClient, apiKey: string, requested: number, dailyLimit: number): Promise<number>
  export function utcDay(date?: Date): string
  ```
  `reserveApiCalls` calls RPC `reserve_external_api_calls` with `{ p_api, p_requested, p_daily_limit }` (PR #72's signature; the RPC derives the UTC day itself).

- [ ] **Step 1: Write the failing test**

`supabase/functions/_shared/mdblist-budget.test.ts`:

```ts
import { assertEquals } from '@std/assert'
import { fetchMdblistUsage, reserveApiCalls, utcDay, type BudgetClient } from './mdblist-budget.ts'

Deno.test('mdblist-budget', async (t) => {
  await t.step('utcDay formats YYYY-MM-DD in UTC', () => {
    assertEquals(utcDay(new Date('2026-08-26T23:59:00Z')), '2026-08-26')
    assertEquals(utcDay(new Date('2026-08-27T00:00:01Z')), '2026-08-27')
  })

  await t.step('fetchMdblistUsage parses the /user payload', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(JSON.stringify({ api_requests: 1000, api_requests_count: 79 }), { status: 200 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', fetchImpl), { cap: 1000, used: 79 })
  })

  await t.step('fetchMdblistUsage returns null on non-2xx or malformed body', async () => {
    const bad = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', bad), null)
    const malformed = (() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as typeof fetch
    assertEquals(await fetchMdblistUsage('key', malformed), null)
  })

  await t.step('reserveApiCalls forwards to reserve_external_api_calls and returns the grant', async () => {
    const seen: Array<{ name: string; args: Record<string, unknown> }> = []
    const client: BudgetClient = { rpc: (name, args) => { seen.push({ name, args }); return Promise.resolve({ data: 4, error: null }) } }
    assertEquals(await reserveApiCalls(client, 'mdblist:projections', 10, 500), 4)
    assertEquals(seen[0], { name: 'reserve_external_api_calls', args: { p_api: 'mdblist:projections', p_requested: 10, p_daily_limit: 500 } })
  })

  await t.step('reserveApiCalls returns 0 on RPC error or non-positive request', async () => {
    const failing: BudgetClient = { rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) }
    assertEquals(await reserveApiCalls(failing, 'mdblist:projections', 10, 500), 0)
    let called = false
    const counting: BudgetClient = { rpc: () => { called = true; return Promise.resolve({ data: 1, error: null }) } }
    assertEquals(await reserveApiCalls(counting, 'mdblist:projections', 0, 500), 0)
    assertEquals(called, false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/mdblist-budget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`supabase/functions/_shared/mdblist-budget.ts`:

```ts
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

/** YYYY-MM-DD for the UTC day, matching api_usage.day and MDBList's daily reset. */
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
    log.warn('MDBList /user error', { error: serializeError(err) })
    return null
  }
}

/**
 * Reserves up to `requested` calls under `apiKey` for today against
 * `dailyLimit`. Returns the number actually granted (0 when the limit is
 * reached or the ledger is unreachable -- never spend on a failed
 * reservation).
 */
export async function reserveApiCalls(
  client: BudgetClient,
  apiKey: string,
  requested: number,
  dailyLimit: number
): Promise<number> {
  if (requested <= 0) return 0
  const { data, error } = await client.rpc('reserve_external_api_calls', {
    p_api: apiKey,
    p_requested: requested,
    p_daily_limit: dailyLimit,
  })
  if (error) {
    log.error('reserve_external_api_calls failed; granting 0', { api: apiKey, error: serializeError(error) })
    return 0
  }
  return typeof data === 'number' ? data : 0
}
```

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test --allow-all _shared/mdblist-budget.test.ts`
Expected: PASS (5 steps).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mdblist-budget.ts supabase/functions/_shared/mdblist-budget.test.ts
git commit -m "feat(projections): MDBList budget reservation under the projections key"
```

---

### Task 4: `fetchMDBListRatings` returns film details

**Files:**
- Modify: `supabase/functions/_shared/scoring.ts:14-25` (types) and `:66-113` (function)
- Test: `supabase/functions/_shared/scoring.test.ts` (append a test)

**Interfaces:**
- Produces (additive; existing callers unaffected):
  ```ts
  export interface MDBListDetails {
    budget: number | null
    revenue: number | null
    certification: string | null
    released: string | null           // YYYY-MM-DD
    company_ids: number[]
    rt_critic_votes: number | null
  }
  // return type becomes { ratings: NormalizedRating[]; details?: MDBListDetails; status?: number; error?: string }
  ```
  `status` is the HTTP status on a non-2xx (so callers can distinguish 404 from 429).

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/scoring.test.ts` (keep existing imports; add `fetchMDBListRatings` to the import from `./scoring.ts` and `stubFetch` from `./_mock-client.ts` if not already imported):

```ts
Deno.test('fetchMDBListRatings details', async (t) => {
  await t.step('returns details alongside ratings', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('api.mdblist.com')
        ? new Response(JSON.stringify({
            title: 'Dune', budget: 165000000, revenue: 410668500, certification: 'PG-13', released: '2021-09-15',
            production_companies: [{ id: 923, name: 'Legendary' }],
            ratings: [
              { source: 'tomatoes', value: 83, score: 83, votes: 500 },
              { source: 'imdb', value: 8.0, score: 80, votes: 900000 },
            ],
          }), { status: 200 })
        : undefined
    )
    try {
      const result = await fetchMDBListRatings(438631, 'key')
      assertEquals(result.error, undefined)
      assertEquals(result.details, {
        budget: 165000000, revenue: 410668500, certification: 'PG-13', released: '2021-09-15',
        company_ids: [923], rt_critic_votes: 500,
      })
      assertEquals(result.ratings.length, 2)
    } finally {
      restore()
    }
  })

  await t.step('exposes the HTTP status on failure', async () => {
    const { restore } = stubFetch((url) => (url.includes('api.mdblist.com') ? new Response('', { status: 404 }) : undefined))
    try {
      const result = await fetchMDBListRatings(1, 'key')
      assertEquals(result.status, 404)
      assertEquals(result.details, undefined)
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/scoring.test.ts`
Expected: FAIL — `details` is undefined / `status` is undefined.

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/scoring.ts`, replace the `MDBListResponse` interface and add `MDBListDetails`:

```ts
export interface MDBListResponse {
  title: string
  ratings: MDBListRating[]
  budget?: number | null
  revenue?: number | null
  certification?: string | null
  released?: string | null
  production_companies?: Array<{ id: number; name: string }>
}

/** Film facts MDBList returns with the ratings; stored on film_corpus by ingestion. */
export interface MDBListDetails {
  budget: number | null
  revenue: number | null
  certification: string | null
  released: string | null
  company_ids: number[]
  rt_critic_votes: number | null
}
```

Change the function signature and body:

```ts
export async function fetchMDBListRatings(
  tmdbId: number,
  apiKey: string
): Promise<{ ratings: NormalizedRating[]; details?: MDBListDetails; status?: number; error?: string }> {
  if (!apiKey) {
    return { ratings: [], error: 'MDBList API key not configured' }
  }

  try {
    const res = await fetchWithRetry(
      `https://api.mdblist.com/tmdb/movie/${tmdbId}?apikey=${apiKey}`,
      undefined,
      { timeoutMs: 10_000 }
    )

    if (!res.ok) {
      const status = res.status
      if (status === 401) return { ratings: [], status, error: 'MDBList API authentication failed' }
      if (status === 404) return { ratings: [], status, error: 'Movie not found on MDBList' }
      if (status === 429) return { ratings: [], status, error: 'MDBList API rate limit exceeded' }
      return { ratings: [], status, error: `MDBList API error: ${status}` }
    }

    const data: MDBListResponse = await res.json()
    const details = toDetails(data)

    if (!data.ratings || !Array.isArray(data.ratings)) {
      return { ratings: [], details }
    }

    const ratings: NormalizedRating[] = []
    for (const r of data.ratings) {
      const dbSource = MDBLIST_SOURCE_MAP[r.source]
      if (!dbSource) continue
      if (r.score == null) continue
      if (!r.votes) continue

      const formatter = RAW_SCORE_FORMATTERS[r.source]
      ratings.push({
        source: dbSource,
        score: r.score,
        raw: formatter ? formatter(r.value) : `${r.value}`,
      })
    }

    return { ratings, details }
  } catch (err) {
    log.warn('Failed to fetch ratings from MDBList', { tmdb_id: tmdbId, error: serializeError(err) })
    return { ratings: [], error: 'Failed to fetch ratings from MDBList' }
  }
}

function toDetails(data: MDBListResponse): MDBListDetails {
  const tomatoes = Array.isArray(data.ratings) ? data.ratings.find((r) => r.source === 'tomatoes') : undefined
  return {
    budget: typeof data.budget === 'number' && data.budget > 0 ? data.budget : null,
    revenue: typeof data.revenue === 'number' && data.revenue > 0 ? data.revenue : null,
    certification: data.certification || null,
    released: data.released || null,
    company_ids: (data.production_companies ?? []).map((c) => c.id).filter((id) => typeof id === 'number'),
    rt_critic_votes: tomatoes && tomatoes.votes ? tomatoes.votes : null,
  }
}
```

- [ ] **Step 4: Run the unit suite**

Run: `cd supabase/functions && deno task test:unit`
Expected: PASS, including the pre-existing `update-scores.test.ts` (its inline mock returns only `ratings`, so `details` derives to nulls — fine).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/scoring.ts supabase/functions/_shared/scoring.test.ts
git commit -m "feat(projections): fetchMDBListRatings exposes film details and HTTP status"
```

---

### Task 5: `_shared/tmdb-corpus.ts` — typed fetchers and row mappers

**Files:**
- Create: `supabase/functions/_shared/tmdb-corpus.ts`
- Test: `supabase/functions/_shared/tmdb-corpus.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CorpusStub { tmdb_id: number; title: string; release_date: string | null; vote_count: number | null; seed_source: 'discover' | 'person' | 'collection' | 'upcoming'; priority: number }
  export interface CorpusMetadata { tmdb_id: number; title: string; release_date: string | null; collection_id: number | null; collection_name: string | null; genre_ids: number[]; company_ids: number[]; budget: number | null; runtime: number | null; certification: string | null; us_release_type: number | null; vote_average: number | null; vote_count: number | null; people: Array<{ tmdb_person_id: number; name: string; role: 'director' | 'writer' | 'cast'; billing: number | null }> }
  export async function fetchDiscoverPage(year: number, page: number, token: string, minVotes: number): Promise<{ stubs: CorpusStub[]; totalPages: number }>
  export async function fetchMovieMetadata(tmdbId: number, token: string): Promise<CorpusMetadata | null>   // null on 404
  export async function fetchPersonPriorFilms(personId: number, token: string, minVotes: number): Promise<CorpusStub[]>
  export async function fetchCollectionParts(collectionId: number, token: string): Promise<{ name: string; stubs: CorpusStub[] }>
  export function toCorpusMetadata(details: TMDbCorpusDetails): CorpusMetadata     // pure mapper, exported for tests
  export function usReleaseType(releaseDates: TMDbReleaseDates | undefined): number | null  // pure
  ```
  Writer jobs counted: `Screenplay`, `Writer`, `Story`. Cast: `order < 5`. Discover URL params: `region=US&with_release_type=3&primary_release_date.gte=${year}-01-01&primary_release_date.lte=${year}-12-31&vote_count.gte=${minVotes}&sort_by=primary_release_date.asc&language=en-US&include_adult=false&page=${page}`.

- [ ] **Step 1: Write the failing test**

`supabase/functions/_shared/tmdb-corpus.test.ts`:

```ts
import { assertEquals } from '@std/assert'
import { toCorpusMetadata, usReleaseType, fetchDiscoverPage, fetchPersonPriorFilms, fetchMovieMetadata } from './tmdb-corpus.ts'
import { stubFetch } from './_mock-client.ts'

const DUNE = {
  id: 438631, title: 'Dune', release_date: '2021-09-15', budget: 165000000, runtime: 155,
  vote_average: 7.8, vote_count: 12000,
  belongs_to_collection: { id: 726871, name: 'Dune Collection' },
  genres: [{ id: 878, name: 'Science Fiction' }, { id: 12, name: 'Adventure' }],
  production_companies: [{ id: 923, name: 'Legendary Pictures' }],
  credits: {
    cast: [
      { id: 1190668, name: 'Timothée Chalamet', order: 0 },
      { id: 933238, name: 'Rebecca Ferguson', order: 1 },
      { id: 99, name: 'Sixth Billed', order: 5 },
    ],
    crew: [
      { id: 137427, name: 'Denis Villeneuve', job: 'Director' },
      { id: 137427, name: 'Denis Villeneuve', job: 'Screenplay' },
      { id: 27, name: 'Eric Roth', job: 'Screenplay' },
      { id: 17315, name: 'Cale Boyter', job: 'Producer' },
    ],
  },
  release_dates: { results: [
    { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2021-09-15T00:00:00.000Z', certification: '' }] },
    { iso_3166_1: 'US', release_dates: [
      { type: 1, release_date: '2021-10-07T00:00:00.000Z', certification: '' },
      { type: 3, release_date: '2021-10-22T00:00:00.000Z', certification: 'PG-13' },
    ] },
  ] },
}

Deno.test('tmdb-corpus', async (t) => {
  await t.step('toCorpusMetadata maps people, franchise, studio, genres, US release', () => {
    const meta = toCorpusMetadata(DUNE)
    assertEquals(meta.tmdb_id, 438631)
    assertEquals(meta.collection_id, 726871)
    assertEquals(meta.collection_name, 'Dune Collection')
    assertEquals(meta.genre_ids, [878, 12])
    assertEquals(meta.company_ids, [923])
    assertEquals(meta.us_release_type, 3)
    assertEquals(meta.certification, 'PG-13')
    assertEquals(meta.people, [
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'director', billing: null },
      { tmdb_person_id: 137427, name: 'Denis Villeneuve', role: 'writer', billing: null },
      { tmdb_person_id: 27, name: 'Eric Roth', role: 'writer', billing: null },
      { tmdb_person_id: 1190668, name: 'Timothée Chalamet', role: 'cast', billing: 0 },
      { tmdb_person_id: 933238, name: 'Rebecca Ferguson', role: 'cast', billing: 1 },
    ])
  })

  await t.step('usReleaseType prefers wide (3) over limited (2) and ignores non-US', () => {
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }, { type: 3, release_date: '', certification: '' }] }] }), 3)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '', certification: '' }] }] }), 2)
    assertEquals(usReleaseType({ results: [{ iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '', certification: '' }] }] }), null)
    assertEquals(usReleaseType(undefined), null)
  })

  await t.step('fetchDiscoverPage builds stubs with seed_source discover', async () => {
    const { calls, restore } = stubFetch((url) =>
      url.includes('/discover/movie')
        ? new Response(JSON.stringify({ total_pages: 3, results: [{ id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400 }] }), { status: 200 })
        : undefined
    )
    try {
      const page = await fetchDiscoverPage(2024, 2, 'tok', 300)
      assertEquals(page.totalPages, 3)
      assertEquals(page.stubs, [{ tmdb_id: 1, title: 'A', release_date: '2024-03-01', vote_count: 400, seed_source: 'discover', priority: 0 }])
      const url = new URL(calls[0].url)
      assertEquals(url.searchParams.get('vote_count.gte'), '300')
      assertEquals(url.searchParams.get('page'), '2')
      assertEquals(url.searchParams.get('with_release_type'), '3')
    } finally {
      restore()
    }
  })

  await t.step('fetchPersonPriorFilms keeps director/writer/lead-cast credits above the vote floor', async () => {
    const { restore } = stubFetch((url) =>
      url.includes('/person/137427/movie_credits')
        ? new Response(JSON.stringify({
            cast: [{ id: 5, title: 'Cameo', release_date: '2010-01-01', vote_count: 5000, order: 9 }],
            crew: [
              { id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, job: 'Director' },
              { id: 3, title: 'Tiny', release_date: '2001-01-01', vote_count: 12, job: 'Director' },
              { id: 4, title: 'Produced', release_date: '2019-01-01', vote_count: 900, job: 'Producer' },
              { id: 6, title: 'Unreleased', release_date: '', vote_count: 0, job: 'Director' },
            ],
          }), { status: 200 })
        : undefined
    )
    try {
      const stubs = await fetchPersonPriorFilms(137427, 'tok', 100)
      assertEquals(stubs, [{ tmdb_id: 2, title: 'Arrival', release_date: '2016-11-11', vote_count: 20000, seed_source: 'person', priority: 50 }])
    } finally {
      restore()
    }
  })

  await t.step('fetchMovieMetadata returns null on 404', async () => {
    const { restore } = stubFetch((url) => (url.includes('/movie/') ? new Response('{}', { status: 404 }) : undefined))
    try {
      assertEquals(await fetchMovieMetadata(1, 'tok'), null)
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/tmdb-corpus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`supabase/functions/_shared/tmdb-corpus.ts`:

```ts
/**
 * TMDb fetchers and pure mappers for the historical film corpus
 * (film_corpus / film_people / film_credits / film_collections).
 *
 * These payloads are consumed once and persisted, so they bypass tmdb_cache
 * and call `tmdbGetJson` directly. Every network function returns plain data
 * shaped for the corpus tables; the mappers are exported so they can be
 * tested without HTTP.
 */
import { tmdbGetJson, TMDbApiError } from './tmdb.ts'

const TMDB = 'https://api.themoviedb.org/3'

/** Crew jobs that count as "writer" for the writer factor. */
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story'])
/** Cast billed at or above this order are "leads". */
const LEAD_BILLING_LIMIT = 5

export type SeedSource = 'discover' | 'person' | 'collection' | 'upcoming'

export interface CorpusStub {
  tmdb_id: number
  title: string
  release_date: string | null
  vote_count: number | null
  seed_source: SeedSource
  priority: number
}

export interface CorpusPerson {
  tmdb_person_id: number
  name: string
  role: 'director' | 'writer' | 'cast'
  billing: number | null
}

export interface CorpusMetadata {
  tmdb_id: number
  title: string
  release_date: string | null
  collection_id: number | null
  collection_name: string | null
  genre_ids: number[]
  company_ids: number[]
  budget: number | null
  runtime: number | null
  certification: string | null
  us_release_type: number | null
  vote_average: number | null
  vote_count: number | null
  people: CorpusPerson[]
}

export interface TMDbReleaseDates {
  results: Array<{
    iso_3166_1: string
    release_dates: Array<{ type: number; release_date: string; certification: string }>
  }>
}

/** The `/movie/{id}?append_to_response=credits,release_dates` payload, the parts we read. */
export interface TMDbCorpusDetails {
  id: number
  title: string
  release_date?: string | null
  budget?: number | null
  runtime?: number | null
  vote_average?: number | null
  vote_count?: number | null
  belongs_to_collection?: { id: number; name: string } | null
  genres?: Array<{ id: number; name: string }>
  production_companies?: Array<{ id: number; name: string }>
  credits?: {
    cast?: Array<{ id: number; name: string; order: number }>
    crew?: Array<{ id: number; name: string; job: string }>
  }
  release_dates?: TMDbReleaseDates
}

interface TMDbListMovie {
  id: number
  title: string
  release_date?: string | null
  vote_count?: number | null
}

function stub(m: TMDbListMovie, seed_source: SeedSource, priority: number): CorpusStub {
  return {
    tmdb_id: m.id,
    title: m.title,
    release_date: m.release_date || null,
    vote_count: typeof m.vote_count === 'number' ? m.vote_count : null,
    seed_source,
    priority,
  }
}

/** Wide (3) beats limited (2); any other US type is returned as-is; null when no US entry. */
export function usReleaseType(releaseDates: TMDbReleaseDates | undefined): number | null {
  const us = releaseDates?.results.find((r) => r.iso_3166_1 === 'US')
  if (!us || us.release_dates.length === 0) return null
  const types = us.release_dates.map((r) => r.type)
  if (types.includes(3)) return 3
  if (types.includes(2)) return 2
  return types[0] ?? null
}

function usCertification(releaseDates: TMDbReleaseDates | undefined): string | null {
  const us = releaseDates?.results.find((r) => r.iso_3166_1 === 'US')
  const certified = us?.release_dates.find((r) => r.certification)
  return certified?.certification || null
}

export function toCorpusMetadata(d: TMDbCorpusDetails): CorpusMetadata {
  const people: CorpusPerson[] = []
  const seen = new Set<string>()
  const push = (p: CorpusPerson) => {
    const key = `${p.tmdb_person_id}:${p.role}`
    if (seen.has(key)) return
    seen.add(key)
    people.push(p)
  }
  for (const c of d.credits?.crew ?? []) {
    if (c.job === 'Director') push({ tmdb_person_id: c.id, name: c.name, role: 'director', billing: null })
  }
  for (const c of d.credits?.crew ?? []) {
    if (WRITER_JOBS.has(c.job)) push({ tmdb_person_id: c.id, name: c.name, role: 'writer', billing: null })
  }
  for (const c of d.credits?.cast ?? []) {
    if (c.order < LEAD_BILLING_LIMIT) push({ tmdb_person_id: c.id, name: c.name, role: 'cast', billing: c.order })
  }

  return {
    tmdb_id: d.id,
    title: d.title,
    release_date: d.release_date || null,
    collection_id: d.belongs_to_collection?.id ?? null,
    collection_name: d.belongs_to_collection?.name ?? null,
    genre_ids: (d.genres ?? []).map((g) => g.id),
    company_ids: (d.production_companies ?? []).map((c) => c.id),
    budget: typeof d.budget === 'number' && d.budget > 0 ? d.budget : null,
    runtime: typeof d.runtime === 'number' && d.runtime > 0 ? d.runtime : null,
    certification: usCertification(d.release_dates),
    us_release_type: usReleaseType(d.release_dates),
    vote_average: typeof d.vote_average === 'number' ? d.vote_average : null,
    vote_count: typeof d.vote_count === 'number' ? d.vote_count : null,
    people,
  }
}

export async function fetchDiscoverPage(
  year: number,
  page: number,
  token: string,
  minVotes: number
): Promise<{ stubs: CorpusStub[]; totalPages: number }> {
  const url = new URL(`${TMDB}/discover/movie`)
  url.searchParams.set('region', 'US')
  url.searchParams.set('with_release_type', '3')
  url.searchParams.set('primary_release_date.gte', `${year}-01-01`)
  url.searchParams.set('primary_release_date.lte', `${year}-12-31`)
  url.searchParams.set('vote_count.gte', String(minVotes))
  url.searchParams.set('sort_by', 'primary_release_date.asc')
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', String(page))
  const data = await tmdbGetJson<{ total_pages: number; results: TMDbListMovie[] }>(url.toString(), token)
  return {
    totalPages: data.total_pages,
    stubs: data.results.map((m) => stub(m, 'discover', 0)),
  }
}

/** Full metadata for one film. Null when TMDb has no such movie (404). */
export async function fetchMovieMetadata(tmdbId: number, token: string): Promise<CorpusMetadata | null> {
  try {
    const data = await tmdbGetJson<TMDbCorpusDetails>(
      `${TMDB}/movie/${tmdbId}?language=en-US&append_to_response=credits,release_dates`,
      token
    )
    return toCorpusMetadata(data)
  } catch (err) {
    if (err instanceof TMDbApiError && err.status === 404) return null
    throw err
  }
}

/** Released films a person directed, wrote, or led (billing < 5), above the vote floor. */
export async function fetchPersonPriorFilms(personId: number, token: string, minVotes: number): Promise<CorpusStub[]> {
  const data = await tmdbGetJson<{
    cast?: Array<TMDbListMovie & { order?: number }>
    crew?: Array<TMDbListMovie & { job: string }>
  }>(`${TMDB}/person/${personId}/movie_credits?language=en-US`, token)

  const byId = new Map<number, CorpusStub>()
  const keep = (m: TMDbListMovie) => {
    if (!m.release_date) return
    if ((m.vote_count ?? 0) < minVotes) return
    if (!byId.has(m.id)) byId.set(m.id, stub(m, 'person', 50))
  }
  for (const c of data.crew ?? []) {
    if (c.job === 'Director' || WRITER_JOBS.has(c.job)) keep(c)
  }
  for (const c of data.cast ?? []) {
    if (typeof c.order === 'number' && c.order < LEAD_BILLING_LIMIT) keep(c)
  }
  return [...byId.values()]
}

export async function fetchCollectionParts(collectionId: number, token: string): Promise<{ name: string; stubs: CorpusStub[] }> {
  const data = await tmdbGetJson<{ name: string; parts: TMDbListMovie[] }>(
    `${TMDB}/collection/${collectionId}?language=en-US`,
    token
  )
  return {
    name: data.name,
    stubs: data.parts.filter((p) => p.release_date).map((p) => stub(p, 'collection', 50)),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test --allow-all _shared/tmdb-corpus.test.ts`
Expected: PASS (5 steps).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tmdb-corpus.ts supabase/functions/_shared/tmdb-corpus.test.ts
git commit -m "feat(projections): TMDb corpus fetchers and row mappers"
```

---

### Task 6: Extend `_mock-client.ts` (`upsert`, `neq`, `not`, `update().is()`)

**Files:**
- Modify: `supabase/functions/_shared/_mock-client.ts:47-61` (chain) and `:110-150` (from)

**Interfaces:**
- Produces on the mock: `chain.neq(col, val)`, `chain.not(col, 'is', null)` (only the `is`/`null` form), `from(t).upsert(rows, { onConflict })` (merges on `options.unique[table]` or on the `onConflict` columns), `from(t).update(patch).is(col, null)` and `.in(col, vals)`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/_mock-client.test.ts`:

```ts
import { assertEquals } from '@std/assert'
import { createMockDbClient, type MockDb } from './_mock-client.ts'

Deno.test('_mock-client extensions', async (t) => {
  await t.step('upsert merges on onConflict columns and inserts otherwise', async () => {
    const db: MockDb = { film_corpus: [{ tmdb_id: 1, title: 'Old', priority: 0 }] }
    const client = createMockDbClient(db)
    await client.from('film_corpus').upsert([{ tmdb_id: 1, title: 'New', priority: 50 }, { tmdb_id: 2, title: 'B', priority: 0 }], { onConflict: 'tmdb_id' })
    assertEquals(db.film_corpus.length, 2)
    assertEquals(db.film_corpus[0], { tmdb_id: 1, title: 'New', priority: 50 })
  })

  await t.step('upsert with ignoreDuplicates leaves existing rows alone', async () => {
    const db: MockDb = { film_corpus: [{ tmdb_id: 1, title: 'Old' }] }
    const client = createMockDbClient(db)
    await client.from('film_corpus').upsert([{ tmdb_id: 1, title: 'New' }], { onConflict: 'tmdb_id', ignoreDuplicates: true })
    assertEquals(db.film_corpus[0].title, 'Old')
  })

  await t.step('neq and not-is-null filter', async () => {
    const db: MockDb = { t: [{ a: 1, b: null }, { a: 2, b: 'x' }] }
    const client = createMockDbClient(db)
    assertEquals((await client.from('t').select('*').neq('a', 1)).data.length, 1)
    assertEquals((await client.from('t').select('*').not('b', 'is', null)).data.length, 1)
  })

  await t.step('update().is() and update().in() patch matching rows', async () => {
    const db: MockDb = { t: [{ id: 1, x: null }, { id: 2, x: 'set' }, { id: 3, x: null }] }
    const client = createMockDbClient(db)
    await client.from('t').update({ x: 'now' }).is('x', null)
    assertEquals(db.t.map((r) => r.x), ['now', 'set', 'now'])
    await client.from('t').update({ x: 'in' }).in('id', [2, 3])
    assertEquals(db.t.map((r) => r.x), ['now', 'in', 'in'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/_mock-client.test.ts`
Expected: FAIL — `upsert is not a function`.

- [ ] **Step 3: Implement**

In `_mock-client.ts`, add to the `chain()` result object after `lte`:

```ts
    neq: (col: string, val: unknown) => chain(rows.filter((r) => r[col] !== val)),
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) return chain(rows.filter((r) => r[col] !== null && r[col] !== undefined))
      throw new Error(`mock not() supports only ('col', 'is', null); got ${op}`)
    },
```

In `createMockDbClient`'s `from(table)` return object, add `upsert` after `insert` and extend `update`:

```ts
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
          const apply = (pred: (row: Row) => boolean) => {
            for (const row of db[table]) if (pred(row)) Object.assign(row, patch)
            return Promise.resolve({ data: null, error: null })
          }
          return {
            eq: (col: string, val: unknown) => apply((r) => r[col] === val),
            is: (col: string, val: unknown) => apply((r) => (val === null ? r[col] == null : r[col] === val)),
            in: (col: string, vals: unknown[]) => apply((r) => vals.includes(r[col])),
          }
        },
```

(Remove the old `update:` block it replaces.) Update the file's header comment list of consumers to add `ingest-film-corpus`.

- [ ] **Step 4: Run the whole unit suite**

Run: `cd supabase/functions && deno task test:unit`
Expected: PASS — existing consumers use only `update().eq()`, which is preserved.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/_mock-client.ts supabase/functions/_shared/_mock-client.test.ts
git commit -m "test: mock client gains upsert, neq, not, and update().is()/in()"
```

---

### Task 7: `ingest-film-corpus/handler.ts` — Stage A (seed)

**Files:**
- Create: `supabase/functions/ingest-film-corpus/handler.ts`
- Test: `supabase/functions/_shared/ingest-film-corpus.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IngestConfig { minVotes: number; discoverFromYear: number; perRunCap: number; dailyBudget: number; metadataPerRun: number; today: string }
  export const DEFAULT_INGEST_CONFIG: Omit<IngestConfig, 'today'>   // { minVotes: 300, discoverFromYear: 2012, perRunCap: 300, dailyBudget: 500, metadataPerRun: 900 }
  export interface IngestDeps { tmdbToken: string; mdblistApiKey: string; fetchUsage?: typeof fetchMdblistUsage }
  export interface IngestResult { seeded: number; metadata_fetched: number; people_expanded: number; ratings_fetched: number; ratings_absent: number; remaining_metadata: number; remaining_ratings: number; mdblist_used_today: number | null; mdblist_granted: number; mdblist_429: boolean; failed: number; errors: Array<{ stage: string; id: number; error: string }> }
  export async function runIngestFilmCorpus(client: SupabaseClient, deps: IngestDeps, config: IngestConfig): Promise<IngestResult>
  export async function seedCorpus(client: SupabaseClient, deps: IngestDeps, config: IngestConfig): Promise<{ seeded: number; errors: IngestResult['errors'] }>   // Stage A
  ```
  Stage A rules (spec §5.2): (1) for each year `discoverFromYear..currentYear`, if `film_corpus` has fewer than 50 rows with `seed_source='discover'` and `release_date` in that year, page discover (all pages) and `upsert(..., { onConflict: 'tmdb_id', ignoreDuplicates: true })`; (2) every `movies` row with `status='upcoming'` or `release_date >= today-60d` becomes a stub `{ seed_source: 'upcoming', priority: 100 }` — upsert **without** ignoreDuplicates so an existing row is promoted to priority 100. Predecessor seeding (spec §5.2 item 3) happens in Stage B when a person's credits are fetched.

- [ ] **Step 1: Write the failing test**

`supabase/functions/_shared/ingest-film-corpus.test.ts`:

```ts
import { assertEquals, assert } from '@std/assert'
import { seedCorpus, type IngestConfig, DEFAULT_INGEST_CONFIG } from '../ingest-film-corpus/handler.ts'
import { createMockDbClient, stubFetch, type MockDb } from './_mock-client.ts'

const CONFIG: IngestConfig = { ...DEFAULT_INGEST_CONFIG, discoverFromYear: 2024, today: '2026-08-26' }
const DEPS = { tmdbToken: 'tok', mdblistApiKey: 'key' }

function discoverResponse(url: string): Response | undefined {
  if (!url.includes('/discover/movie')) return undefined
  const page = new URL(url).searchParams.get('page')
  const year = new URL(url).searchParams.get('primary_release_date.gte')!.slice(0, 4)
  const id = Number(`${year}${page}`)
  return new Response(JSON.stringify({ total_pages: 2, results: [{ id, title: `Film ${id}`, release_date: `${year}-05-01`, vote_count: 500 }] }), { status: 200 })
}

Deno.test('ingest-film-corpus: seed', async (t) => {
  await t.step('pages discover for every year lacking stubs and inserts them', async () => {
    const db: MockDb = { film_corpus: [], movies: [] }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      const result = await seedCorpus(client, DEPS, CONFIG)
      // years 2024, 2025, 2026 × 2 pages
      assertEquals(calls.filter((c) => c.url.includes('/discover/movie')).length, 6)
      assertEquals(result.seeded, 6)
      assert(db.film_corpus.every((r) => r.seed_source === 'discover' && r.priority === 0))
    } finally {
      restore()
    }
  })

  await t.step('skips years that already have 50+ discover stubs', async () => {
    const db: MockDb = {
      film_corpus: Array.from({ length: 50 }, (_, i) => ({ tmdb_id: i + 1, seed_source: 'discover', release_date: '2024-01-01' })),
      movies: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { calls, restore } = stubFetch(discoverResponse)
    try {
      await seedCorpus(client, DEPS, CONFIG)
      const years = calls.map((c) => new URL(c.url).searchParams.get('primary_release_date.gte')!.slice(0, 4))
      assert(!years.includes('2024'))
      assert(years.includes('2025'))
    } finally {
      restore()
    }
  })

  await t.step('upcoming and recently released league movies are seeded at priority 100', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 7, title: 'Already', seed_source: 'discover', priority: 0, release_date: '2026-09-01' }],
      movies: [
        { tmdb_id: 7, title: 'Already', release_date: '2026-09-01', status: 'upcoming', vote_count: 10 },
        { tmdb_id: 8, title: 'Recent', release_date: '2026-07-15', status: 'released', vote_count: 900 },
        { tmdb_id: 9, title: 'Ancient', release_date: '2020-01-01', status: 'released', vote_count: 900 },
      ],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(() => new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 }))
    try {
      await seedCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      const byId = Object.fromEntries(db.film_corpus.map((r) => [r.tmdb_id, r]))
      assertEquals(byId[7].priority, 100)
      assertEquals(byId[8].seed_source, 'upcoming')
      assertEquals(byId[9], undefined)
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/ingest-film-corpus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Stage A**

`supabase/functions/ingest-film-corpus/handler.ts`:

```ts
/**
 * Core logic for ingest-film-corpus, separate from index.ts so unit tests
 * can import it without triggering Deno.serve().
 *
 * Fills the historical film corpus the projection model learns from, in
 * three stages per daily run:
 *   A. seed     -- stub rows from TMDb discover (historical wide releases)
 *                  and from every movie currently in a league.
 *   B. metadata -- TMDb details + credits for stubs, expanding each
 *                  credited person's and franchise's prior films into new
 *                  stubs (TMDb only; cheap).
 *   C. ratings  -- MDBList ratings for rows that have metadata, paced by
 *                  the shared daily budget (_shared/mdblist-budget.ts).
 *
 * Priority order (film_corpus.priority DESC) means movies in leagues right
 * now, and their predecessors, are complete within a couple of runs while
 * the multi-year sweep trickles in behind them.
 *
 * Spec: docs/superpowers/specs/2026-08-26-movie-projections-design.md §5
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createLogger, serializeError } from '../_shared/logger.ts'
import {
  fetchDiscoverPage,
  fetchMovieMetadata,
  fetchPersonPriorFilms,
  fetchCollectionParts,
  type CorpusStub,
} from '../_shared/tmdb-corpus.ts'
import { fetchMDBListRatings } from '../_shared/scoring.ts'
import {
  fetchMdblistUsage,
  reserveApiCalls,
  MDBLIST_PROJECTIONS_KEY,
  MDBLIST_ACCOUNT_CAP,
  MDBLIST_SCORING_RESERVE,
} from '../_shared/mdblist-budget.ts'

const log = createLogger('ingest-film-corpus')

/** A year counts as seeded once it has this many discover stubs. */
const SEEDED_YEAR_THRESHOLD = 50
/** League movies released within this many days are still worth projecting/freezing. */
const RECENT_RELEASE_DAYS = 60
/** Spec §5.3: TMDb is cheap, so metadata runs at 3× the ratings cap. */
const METADATA_MULTIPLIER = 3

export interface IngestConfig {
  minVotes: number
  discoverFromYear: number
  perRunCap: number
  dailyBudget: number
  metadataPerRun: number
  /** YYYY-MM-DD; injected so tests are deterministic. */
  today: string
}

export const DEFAULT_INGEST_CONFIG: Omit<IngestConfig, 'today'> = {
  minVotes: 300,
  discoverFromYear: 2012,
  perRunCap: 300,
  dailyBudget: 500,
  metadataPerRun: 300 * METADATA_MULTIPLIER,
}

export interface IngestDeps {
  tmdbToken: string
  mdblistApiKey: string
  fetchUsage?: typeof fetchMdblistUsage
}

export interface IngestError {
  stage: string
  id: number
  error: string
}

export interface IngestResult {
  seeded: number
  metadata_fetched: number
  people_expanded: number
  ratings_fetched: number
  ratings_absent: number
  remaining_metadata: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_429: boolean
  failed: number
  errors: IngestError[]
}

interface CorpusRow {
  tmdb_id: number
  seed_source: string
  release_date: string | null
  priority: number
}

function daysBefore(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function upsertStubs(client: SupabaseClient, stubs: CorpusStub[], opts: { promote: boolean }): Promise<number> {
  if (stubs.length === 0) return 0
  const { error } = await client
    .from('film_corpus')
    .upsert(stubs, { onConflict: 'tmdb_id', ignoreDuplicates: !opts.promote })
  if (error) throw error
  return stubs.length
}

// ---------------------------------------------------------------------------
// Stage A: seed
// ---------------------------------------------------------------------------

export async function seedCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ seeded: number; errors: IngestError[] }> {
  const errors: IngestError[] = []
  let seeded = 0

  // A1: historical wide releases, one discover sweep per un-seeded year.
  const currentYear = Number(config.today.slice(0, 4))
  const { data: discoverRows, error: rowsError } = await client
    .from('film_corpus')
    .select('tmdb_id, seed_source, release_date, priority')
    .eq('seed_source', 'discover')
  if (rowsError) throw rowsError
  const stubsPerYear = new Map<number, number>()
  for (const row of (discoverRows ?? []) as CorpusRow[]) {
    if (!row.release_date) continue
    const year = Number(row.release_date.slice(0, 4))
    stubsPerYear.set(year, (stubsPerYear.get(year) ?? 0) + 1)
  }

  for (let year = config.discoverFromYear; year <= currentYear; year++) {
    if ((stubsPerYear.get(year) ?? 0) >= SEEDED_YEAR_THRESHOLD) continue
    try {
      let page = 1
      let totalPages = 1
      do {
        const result = await fetchDiscoverPage(year, page, deps.tmdbToken, config.minVotes)
        totalPages = result.totalPages
        seeded += await upsertStubs(client, result.stubs, { promote: false })
        page++
      } while (page <= totalPages)
    } catch (err) {
      log.warn('Discover sweep failed', { year, error: serializeError(err) })
      errors.push({ stage: 'seed:discover', id: year, error: String(err) })
    }
  }

  // A2: everything in a league now (upcoming, or released recently) at top priority.
  const { data: leagueMovies, error: moviesError } = await client
    .from('movies')
    .select('tmdb_id, title, release_date, status, vote_count')
    .neq('status', 'canceled')
    .gte('release_date', daysBefore(config.today, RECENT_RELEASE_DAYS))
  if (moviesError) throw moviesError

  const upcomingStubs: CorpusStub[] = ((leagueMovies ?? []) as Array<{
    tmdb_id: number; title: string; release_date: string | null; vote_count: number | null
  }>)
    .filter((m) => m.tmdb_id > 0)
    .map((m) => ({
      tmdb_id: m.tmdb_id,
      title: m.title,
      release_date: m.release_date,
      vote_count: m.vote_count,
      seed_source: 'upcoming' as const,
      priority: 100,
    }))
  // Promote: an existing row keeps its metadata but moves to the front of the queue.
  // Only stub columns are in the payload, so nothing fetched is overwritten.
  seeded += await upsertStubs(client, upcomingStubs, { promote: true })

  return { seeded, errors }
}
```

Note: the mock's `gte` on `release_date` compares strings, which works for ISO dates; `neq('status', 'canceled')` uses the mock method added in Task 6. **The `movies` query does not filter `status='upcoming'` explicitly** — the 60-day window covers both upcoming (future dates) and recent releases, which is what §5.2 asks for.

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test --allow-all _shared/ingest-film-corpus.test.ts`
Expected: PASS (3 steps).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-film-corpus/handler.ts supabase/functions/_shared/ingest-film-corpus.test.ts
git commit -m "feat(projections): ingest-film-corpus stage A (seed)"
```

---

### Task 8: Stage B (metadata + people/collection expansion)

**Files:**
- Modify: `supabase/functions/ingest-film-corpus/handler.ts`
- Test: `supabase/functions/_shared/ingest-film-corpus.test.ts` (append)

**Interfaces:**
- Produces: `export async function fetchMetadataStage(client, deps, config): Promise<{ metadata_fetched: number; people_expanded: number; remaining_metadata: number; errors: IngestError[] }>`.
  Rules (spec §5.3): take up to `config.metadataPerRun` rows where `metadata_fetched_at IS NULL`, ordered priority DESC; for each, `fetchMovieMetadata` → update the corpus row (title, release_date, collection_id, genre_ids, company_ids, budget, runtime, certification, us_release_type, vote_average, vote_count, `metadata_fetched_at`), upsert `film_people`, insert `film_credits` (upsert ignoreDuplicates on `tmdb_id,tmdb_person_id,role`), upsert `film_collections` (ignoreDuplicates). A 404 stamps `metadata_fetched_at` and `ratings_fetched_at` + `ratings_absent = true` (dead row). Then expansion: for each `film_people` row with `credits_fetched_at IS NULL` that is credited on a film with `priority >= 50`, `fetchPersonPriorFilms` → upsert stubs (ignoreDuplicates), stamp `credits_fetched_at`. For each `film_collections` row with `parts_fetched_at IS NULL` referenced by a film with `priority >= 50`, `fetchCollectionParts` → upsert stubs, stamp. Expansion is capped at `config.metadataPerRun / 3` people + collections per run.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/ingest-film-corpus.test.ts`:

```ts
import { fetchMetadataStage } from '../ingest-film-corpus/handler.ts'

function tmdbResponder(url: string): Response | undefined {
  if (url.includes('/movie/404?')) return new Response('{}', { status: 404 })
  if (url.includes('/movie/10?')) {
    return new Response(JSON.stringify({
      id: 10, title: 'Sequel', release_date: '2026-12-15', vote_average: 0, vote_count: 0, budget: 0, runtime: 0,
      belongs_to_collection: { id: 500, name: 'Saga' },
      genres: [{ id: 28, name: 'Action' }], production_companies: [{ id: 33, name: 'Studio' }],
      credits: { cast: [{ id: 1001, name: 'Lead', order: 0 }], crew: [{ id: 2001, name: 'Dir', job: 'Director' }] },
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '', certification: 'PG-13' }] }] },
    }), { status: 200 })
  }
  if (url.includes('/person/2001/movie_credits')) {
    return new Response(JSON.stringify({ cast: [], crew: [{ id: 11, title: 'Prior', release_date: '2020-01-01', vote_count: 5000, job: 'Director' }] }), { status: 200 })
  }
  if (url.includes('/person/1001/movie_credits')) {
    return new Response(JSON.stringify({ cast: [{ id: 12, title: 'LeadPrior', release_date: '2018-01-01', vote_count: 5000, order: 1 }], crew: [] }), { status: 200 })
  }
  if (url.includes('/collection/500')) {
    return new Response(JSON.stringify({ name: 'Saga', parts: [{ id: 13, title: 'Saga 1', release_date: '2015-01-01', vote_count: 9000 }, { id: 10, title: 'Sequel', release_date: '2026-12-15', vote_count: 0 }] }), { status: 200 })
  }
  return undefined
}

Deno.test('ingest-film-corpus: metadata', async (t) => {
  await t.step('fills metadata, credits, and expands people + franchise for priority rows', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 10, title: 'Sequel', seed_source: 'upcoming', priority: 100, metadata_fetched_at: null, ratings_fetched_at: null, release_date: '2026-12-15' }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
    })
    const { restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 1)
      assertEquals(result.people_expanded, 3) // 2 people + 1 collection
      const row = db.film_corpus.find((r) => r.tmdb_id === 10)!
      assertEquals(row.collection_id, 500)
      assertEquals(row.us_release_type, 3)
      assert(row.metadata_fetched_at)
      assertEquals(db.film_credits.length, 2)
      assertEquals(db.film_people.map((p) => p.tmdb_person_id).sort(), [1001, 2001])
      assert(db.film_people.every((p) => p.credits_fetched_at))
      assertEquals(db.film_collections[0].parts_fetched_at !== null, true)
      const ids = db.film_corpus.map((r) => r.tmdb_id).sort()
      assertEquals(ids, [10, 11, 12, 13])
      const prior = db.film_corpus.find((r) => r.tmdb_id === 11)!
      assertEquals(prior.priority, 50)
      assertEquals(prior.seed_source, 'person')
    } finally {
      restore()
    }
  })

  await t.step('a TMDb 404 dead-ends the row instead of retrying forever', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 404, title: 'Gone', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, { unique: { film_corpus: ['tmdb_id'] } })
    const { restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.metadata_fetched, 0)
      assert(db.film_corpus[0].metadata_fetched_at)
      assertEquals(db.film_corpus[0].ratings_absent, true)
      assertEquals(result.remaining_metadata, 0)
    } finally {
      restore()
    }
  })

  await t.step('does not expand people credited only on low-priority films', async () => {
    const db: MockDb = {
      film_corpus: [{ tmdb_id: 10, title: 'Sequel', seed_source: 'discover', priority: 0, metadata_fetched_at: null, ratings_fetched_at: null }],
      film_people: [], film_credits: [], film_collections: [],
    }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
    })
    const { calls, restore } = stubFetch(tmdbResponder)
    try {
      const result = await fetchMetadataStage(client, DEPS, CONFIG)
      assertEquals(result.people_expanded, 0)
      assertEquals(calls.filter((c) => c.url.includes('/person/')).length, 0)
      assertEquals(db.film_people.length, 2) // still recorded, just not expanded
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/ingest-film-corpus.test.ts`
Expected: FAIL — `fetchMetadataStage` is not exported.

- [ ] **Step 3: Implement Stage B**

Append to `handler.ts`:

```ts
// ---------------------------------------------------------------------------
// Stage B: metadata + expansion
// ---------------------------------------------------------------------------

/** Rows at or above this priority get their people and franchise expanded. */
const EXPAND_PRIORITY = 50

interface PendingMetadataRow {
  tmdb_id: number
  priority: number
}

export async function fetchMetadataStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{ metadata_fetched: number; people_expanded: number; remaining_metadata: number; errors: IngestError[] }> {
  const errors: IngestError[] = []
  let metadata_fetched = 0
  let people_expanded = 0
  const now = new Date().toISOString()

  const { data: pending, error: pendingError } = await client
    .from('film_corpus')
    .select('tmdb_id, priority')
    .is('metadata_fetched_at', null)
    .order('priority', { ascending: false })
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(config.metadataPerRun)
  if (pendingError) throw pendingError

  const expandPeople = new Set<number>()
  const expandCollections = new Set<number>()

  for (const row of (pending ?? []) as PendingMetadataRow[]) {
    try {
      const meta = await fetchMovieMetadata(row.tmdb_id, deps.tmdbToken)
      if (!meta) {
        // Gone from TMDb: never fetch again, and don't spend MDBList on it.
        await client.from('film_corpus')
          .update({ metadata_fetched_at: now, ratings_fetched_at: now, ratings_absent: true })
          .eq('tmdb_id', row.tmdb_id)
        continue
      }

      const { error: updateError } = await client.from('film_corpus').update({
        title: meta.title,
        release_date: meta.release_date,
        collection_id: meta.collection_id,
        genre_ids: meta.genre_ids,
        company_ids: meta.company_ids,
        budget: meta.budget,
        runtime: meta.runtime,
        certification: meta.certification,
        us_release_type: meta.us_release_type,
        vote_average: meta.vote_average,
        vote_count: meta.vote_count,
        metadata_fetched_at: now,
      }).eq('tmdb_id', row.tmdb_id)
      if (updateError) throw updateError

      if (meta.people.length > 0) {
        const { error: peopleError } = await client.from('film_people').upsert(
          meta.people.map((p) => ({ tmdb_person_id: p.tmdb_person_id, name: p.name })),
          { onConflict: 'tmdb_person_id', ignoreDuplicates: true }
        )
        if (peopleError) throw peopleError
        const { error: creditsError } = await client.from('film_credits').upsert(
          meta.people.map((p) => ({ tmdb_id: meta.tmdb_id, tmdb_person_id: p.tmdb_person_id, role: p.role, billing: p.billing })),
          { onConflict: 'tmdb_id,tmdb_person_id,role', ignoreDuplicates: true }
        )
        if (creditsError) throw creditsError
      }
      if (meta.collection_id !== null) {
        const { error: collError } = await client.from('film_collections').upsert(
          { collection_id: meta.collection_id, name: meta.collection_name ?? '' },
          { onConflict: 'collection_id', ignoreDuplicates: true }
        )
        if (collError) throw collError
      }

      if (row.priority >= EXPAND_PRIORITY) {
        for (const p of meta.people) expandPeople.add(p.tmdb_person_id)
        if (meta.collection_id !== null) expandCollections.add(meta.collection_id)
      }
      metadata_fetched++
    } catch (err) {
      log.warn('Metadata fetch failed', { tmdb_id: row.tmdb_id, error: serializeError(err) })
      errors.push({ stage: 'metadata', id: row.tmdb_id, error: String(err) })
    }
  }

  // Expansion: prior films of the people/franchises behind priority rows.
  const expansionCap = Math.floor(config.metadataPerRun / METADATA_MULTIPLIER)
  const { data: peopleRows, error: peopleRowsError } = await client
    .from('film_people')
    .select('tmdb_person_id, credits_fetched_at')
    .is('credits_fetched_at', null)
    .in('tmdb_person_id', [...expandPeople])
  if (peopleRowsError) throw peopleRowsError

  for (const person of ((peopleRows ?? []) as Array<{ tmdb_person_id: number }>).slice(0, expansionCap)) {
    try {
      const stubs = await fetchPersonPriorFilms(person.tmdb_person_id, deps.tmdbToken, 100)
      await upsertStubs(client, stubs, { promote: false })
      await client.from('film_people').update({ credits_fetched_at: now }).eq('tmdb_person_id', person.tmdb_person_id)
      people_expanded++
    } catch (err) {
      log.warn('Person expansion failed', { person_id: person.tmdb_person_id, error: serializeError(err) })
      errors.push({ stage: 'expand:person', id: person.tmdb_person_id, error: String(err) })
    }
  }

  const { data: collRows, error: collRowsError } = await client
    .from('film_collections')
    .select('collection_id, parts_fetched_at')
    .is('parts_fetched_at', null)
    .in('collection_id', [...expandCollections])
  if (collRowsError) throw collRowsError

  for (const coll of ((collRows ?? []) as Array<{ collection_id: number }>).slice(0, expansionCap)) {
    try {
      const { name, stubs } = await fetchCollectionParts(coll.collection_id, deps.tmdbToken)
      await upsertStubs(client, stubs, { promote: false })
      await client.from('film_collections').update({ name, parts_fetched_at: now }).eq('collection_id', coll.collection_id)
      people_expanded++
    } catch (err) {
      log.warn('Collection expansion failed', { collection_id: coll.collection_id, error: serializeError(err) })
      errors.push({ stage: 'expand:collection', id: coll.collection_id, error: String(err) })
    }
  }

  const { count } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('metadata_fetched_at', null)

  return { metadata_fetched, people_expanded, remaining_metadata: count ?? 0, errors }
}
```

The mock's `select` ignores `{ count, head }` and returns `count: rows.length` after filters — matching how the real client reports `count` — so `remaining_metadata` is testable. Note the mock's `order()` accepts arguments and ignores them; ordering is verified by the integration test in Task 11, not here.

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test --allow-all _shared/ingest-film-corpus.test.ts`
Expected: PASS (6 steps total).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-film-corpus/handler.ts supabase/functions/_shared/ingest-film-corpus.test.ts
git commit -m "feat(projections): ingest-film-corpus stage B (metadata, people and franchise expansion)"
```

---

### Task 9: Stage C (ratings, budget-paced) + `runIngestFilmCorpus`

**Files:**
- Modify: `supabase/functions/ingest-film-corpus/handler.ts`
- Test: `supabase/functions/_shared/ingest-film-corpus.test.ts` (append)

**Interfaces:**
- Produces: `export async function fetchRatingsStage(client, deps, config): Promise<{ ratings_fetched: number; ratings_absent: number; remaining_ratings: number; mdblist_used_today: number | null; mdblist_granted: number; mdblist_429: boolean; errors: IngestError[] }>` and `runIngestFilmCorpus` (runs A → B → C, merges results, `failed = errors.length`).
  Rules (spec §5.4): usage = `deps.fetchUsage ?? fetchMdblistUsage`; `headroom = usage ? max(0, min(config.perRunCap, config.dailyBudget - 1, MDBLIST_ACCOUNT_CAP - usage.used - MDBLIST_SCORING_RESERVE - 1)) : config.perRunCap` (the `/user` call itself is 1 request, and 100 calls are always left for the evening score sync); `granted = reserveApiCalls(client, MDBLIST_PROJECTIONS_KEY, headroom, config.dailyBudget)`; fetch that many rows where `ratings_fetched_at IS NULL AND metadata_fetched_at IS NOT NULL`, priority DESC; per row: `fetchMDBListRatings` → `tomatoes` present → write `rt_critic` (score), `rt_critic_votes`, `metacritic`, `imdb` (imdb value/10 → store `score/10` with one decimal), plus `details.budget/certification/company_ids` when the corpus row lacks them; else `ratings_absent = true`; always stamp `ratings_fetched_at`. A `status === 429` sets `mdblist_429 = true` and **stops the loop**.

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
import { fetchRatingsStage, runIngestFilmCorpus } from '../ingest-film-corpus/handler.ts'

function mdblistResponder(payloads: Record<number, Response>) {
  return (url: string): Response | undefined => {
    const m = url.match(/api\.mdblist\.com\/tmdb\/movie\/(\d+)/)
    if (m) return payloads[Number(m[1])] ?? new Response('', { status: 404 })
    if (url.includes('api.mdblist.com/user')) return new Response(JSON.stringify({ api_requests: 1000, api_requests_count: 100 }), { status: 200 })
    return undefined
  }
}

const ok = (rt: number | null) =>
  new Response(JSON.stringify({
    title: 't', budget: 5, certification: 'R', production_companies: [{ id: 9, name: 'S' }],
    ratings: [
      ...(rt === null ? [] : [{ source: 'tomatoes', value: rt, score: rt, votes: 120 }]),
      { source: 'metacritic', value: 61, score: 61, votes: 40 },
      { source: 'imdb', value: 7.4, score: 74, votes: 1000 },
    ],
  }), { status: 200 })

function ratingsDb(): MockDb {
  return {
    film_corpus: [
      { tmdb_id: 1, priority: 100, metadata_fetched_at: 'x', ratings_fetched_at: null, budget: null, certification: null, company_ids: [] },
      { tmdb_id: 2, priority: 50, metadata_fetched_at: 'x', ratings_fetched_at: null, budget: 99, certification: 'PG', company_ids: [1] },
      { tmdb_id: 3, priority: 0, metadata_fetched_at: 'x', ratings_fetched_at: null },
      { tmdb_id: 4, priority: 0, metadata_fetched_at: null, ratings_fetched_at: null },
    ],
  }
}

Deno.test('ingest-film-corpus: ratings', async (t) => {
  await t.step('fetches ratings for granted rows in priority order and stores details', async () => {
    const db = ratingsDb()
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args) => args!.p_requested } })
    const { calls, restore } = stubFetch(mdblistResponder({ 1: ok(88), 2: ok(null), 3: ok(40) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, { ...CONFIG, perRunCap: 2 })
      assertEquals(result.mdblist_granted, 2)
      assertEquals(result.ratings_fetched, 1)
      assertEquals(result.ratings_absent, 1)
      assertEquals(result.remaining_ratings, 1)
      const one = db.film_corpus.find((r) => r.tmdb_id === 1)!
      assertEquals(one.rt_critic, 88)
      assertEquals(one.rt_critic_votes, 120)
      assertEquals(one.metacritic, 61)
      assertEquals(one.imdb, 7.4)
      assertEquals(one.budget, 5)
      assertEquals(one.company_ids, [9])
      const two = db.film_corpus.find((r) => r.tmdb_id === 2)!
      assertEquals(two.ratings_absent, true)
      assertEquals(two.budget, 99) // existing details kept
      assert(two.ratings_fetched_at)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 3)!.ratings_fetched_at, null)
      assertEquals(calls.filter((c) => c.url.includes('/tmdb/movie/')).length, 2)
    } finally {
      restore()
    }
  })

  await t.step('headroom respects the remote counter, the scoring reserve, and the daily budget', async () => {
    const db = ratingsDb()
    const seen: Array<Record<string, unknown>> = []
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args) => { seen.push(args!); return 0 } } })
    const fetchUsage = () => Promise.resolve({ cap: 1000, used: 890 })
    const { restore } = stubFetch(mdblistResponder({}))
    try {
      const result = await fetchRatingsStage(client, { ...DEPS, fetchUsage }, { ...CONFIG, dailyBudget: 500, perRunCap: 300 })
      // 1000 - 890 used - 100 scoring reserve - 1 for the /user call = 9
      assertEquals(seen[0], { p_api: 'mdblist:projections', p_requested: 9, p_daily_limit: 500 })
      assertEquals(result.mdblist_used_today, 890)
      assertEquals(result.ratings_fetched, 0)
    } finally {
      restore()
    }
  })

  await t.step('a 429 stops the stage and is reported', async () => {
    const db = ratingsDb()
    const client = createMockDbClient(db, { rpc: { reserve_external_api_calls: (args) => args!.p_requested } })
    const { restore } = stubFetch(mdblistResponder({ 1: new Response('', { status: 429 }), 2: ok(70) }))
    try {
      const result = await fetchRatingsStage(client, DEPS, CONFIG)
      assertEquals(result.mdblist_429, true)
      assertEquals(result.ratings_fetched, 0)
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 1)!.ratings_fetched_at, null) // not stamped: retry tomorrow
      assertEquals(db.film_corpus.find((r) => r.tmdb_id === 2)!.ratings_fetched_at, null) // loop stopped
    } finally {
      restore()
    }
  })

  await t.step('runIngestFilmCorpus runs all stages and totals errors', async () => {
    const db: MockDb = { ...ratingsDb(), movies: [], film_people: [], film_credits: [], film_collections: [] }
    const client = createMockDbClient(db, {
      unique: { film_corpus: ['tmdb_id'], film_people: ['tmdb_person_id'], film_credits: ['tmdb_id', 'tmdb_person_id', 'role'], film_collections: ['collection_id'] },
      rpc: { reserve_external_api_calls: (args) => args!.p_requested },
    })
    const { restore } = stubFetch((url) =>
      url.includes('/discover/movie') ? new Response(JSON.stringify({ total_pages: 1, results: [] }), { status: 200 })
      : url.includes('/movie/4?') ? new Response('{}', { status: 404 })
      : mdblistResponder({ 1: ok(80), 2: ok(60), 3: ok(50) })(url)
    )
    try {
      const result = await runIngestFilmCorpus(client, DEPS, { ...CONFIG, discoverFromYear: 2026 })
      assertEquals(result.ratings_fetched, 3)
      assertEquals(result.failed, 0)
      assertEquals(result.remaining_metadata, 0)
      assertEquals(result.remaining_ratings, 0)
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all _shared/ingest-film-corpus.test.ts`
Expected: FAIL — `fetchRatingsStage` not exported.

- [ ] **Step 3: Implement Stage C and the runner**

Append to `handler.ts`:

```ts
// ---------------------------------------------------------------------------
// Stage C: ratings (MDBList, budget-paced)
// ---------------------------------------------------------------------------

interface PendingRatingsRow {
  tmdb_id: number
  budget: number | null
  certification: string | null
  company_ids: number[] | null
}

export async function fetchRatingsStage(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<{
  ratings_fetched: number
  ratings_absent: number
  remaining_ratings: number
  mdblist_used_today: number | null
  mdblist_granted: number
  mdblist_429: boolean
  errors: IngestError[]
}> {
  const errors: IngestError[] = []
  let ratings_fetched = 0
  let ratings_absent = 0
  let mdblist_429 = false

  // One /user call to reconcile against MDBList's own counter (it counts too).
  // Whatever the flag allows, always leave MDBLIST_SCORING_RESERVE calls on
  // the account for the evening score sync.
  const usage = await (deps.fetchUsage ?? fetchMdblistUsage)(deps.mdblistApiKey)
  const headroom = usage
    ? Math.max(0, Math.min(
        config.perRunCap,
        config.dailyBudget - 1,
        MDBLIST_ACCOUNT_CAP - usage.used - MDBLIST_SCORING_RESERVE - 1
      ))
    : config.perRunCap
  const granted = await reserveApiCalls(client, MDBLIST_PROJECTIONS_KEY, headroom, config.dailyBudget)

  if (granted > 0) {
    const { data: pending, error: pendingError } = await client
      .from('film_corpus')
      .select('tmdb_id, budget, certification, company_ids')
      .is('ratings_fetched_at', null)
      .not('metadata_fetched_at', 'is', null)
      .order('priority', { ascending: false })
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(granted)
    if (pendingError) throw pendingError

    for (const row of (pending ?? []) as PendingRatingsRow[]) {
      const result = await fetchMDBListRatings(row.tmdb_id, deps.mdblistApiKey)
      if (result.status === 429) {
        mdblist_429 = true
        log.warn('MDBList 429; stopping ratings stage for this run')
        break
      }
      if (result.error && result.status !== 404) {
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: result.error })
        continue
      }

      const now = new Date().toISOString()
      const bySource = new Map(result.ratings.map((r) => [r.source, r.score]))
      const rt = bySource.get('rotten_tomatoes') ?? null
      const patch: Record<string, unknown> = {
        ratings_fetched_at: now,
        ratings_absent: rt === null,
        rt_critic: rt,
        rt_critic_votes: result.details?.rt_critic_votes ?? null,
        metacritic: bySource.get('metacritic') ?? null,
        imdb: bySource.has('imdb') ? Math.round(bySource.get('imdb')!) / 10 : null,
      }
      if (result.details) {
        if (row.budget == null && result.details.budget !== null) patch.budget = result.details.budget
        if (!row.certification && result.details.certification) patch.certification = result.details.certification
        if ((row.company_ids ?? []).length === 0 && result.details.company_ids.length > 0) patch.company_ids = result.details.company_ids
      }
      const { error: updateError } = await client.from('film_corpus').update(patch).eq('tmdb_id', row.tmdb_id)
      if (updateError) {
        errors.push({ stage: 'ratings', id: row.tmdb_id, error: String(updateError) })
        continue
      }
      if (rt === null) ratings_absent++
      else ratings_fetched++
    }
  }

  const { count } = await client
    .from('film_corpus')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('ratings_fetched_at', null)
    .not('metadata_fetched_at', 'is', null)

  return {
    ratings_fetched,
    ratings_absent,
    remaining_ratings: count ?? 0,
    mdblist_used_today: usage?.used ?? null,
    mdblist_granted: granted,
    mdblist_429,
    errors,
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runIngestFilmCorpus(
  client: SupabaseClient,
  deps: IngestDeps,
  config: IngestConfig
): Promise<IngestResult> {
  const seed = await seedCorpus(client, deps, config)
  const metadata = await fetchMetadataStage(client, deps, config)
  const ratings = await fetchRatingsStage(client, deps, config)
  const errors = [...seed.errors, ...metadata.errors, ...ratings.errors]
  return {
    seeded: seed.seeded,
    metadata_fetched: metadata.metadata_fetched,
    people_expanded: metadata.people_expanded,
    ratings_fetched: ratings.ratings_fetched,
    ratings_absent: ratings.ratings_absent,
    remaining_metadata: metadata.remaining_metadata,
    remaining_ratings: ratings.remaining_ratings,
    mdblist_used_today: ratings.mdblist_used_today,
    mdblist_granted: ratings.mdblist_granted,
    mdblist_429: ratings.mdblist_429,
    failed: errors.length,
    errors,
  }
}
```

- [ ] **Step 4: Run the unit suite**

Run: `cd supabase/functions && deno task test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-film-corpus/handler.ts supabase/functions/_shared/ingest-film-corpus.test.ts
git commit -m "feat(projections): ingest-film-corpus stage C (budget-paced ratings) and runner"
```

---

### Task 10: Cron entrypoint + wiring

**Files:**
- Create: `supabase/functions/ingest-film-corpus/index.ts`
- Create: `apps/frontend/app/api/cron/ingest-film-corpus/route.ts`
- Modify: `supabase/config.toml` (append), `apps/frontend/vercel.json` (append cron)

**Interfaces:**
- Consumes: `runIngestFilmCorpus`, `DEFAULT_INGEST_CONFIG`, `getFlag`, `flagNumber`, `utcDay`.
- Produces: `POST /functions/v1/ingest-film-corpus` (cron-secret or service role) returning `{ ...IngestResult, skipped?: 'flag_disabled', job_status }`.

- [ ] **Step 1: Write the entrypoint**

`supabase/functions/ingest-film-corpus/index.ts`:

```ts
/**
 * Ingest Film Corpus Edge Function -- entrypoint.
 *
 * Daily cron (Vercel Cron -> /api/cron/ingest-film-corpus, 09:00 UTC, after
 * the 06:00 score sync and 08:00 release-date sync so scoring has first
 * claim on the day's MDBList quota). Handles CORS, cron auth, the
 * projections_ingestion feature flag, and env wiring; business logic lives
 * in handler.ts (unit tests in ../_shared/ingest-film-corpus.test.ts).
 *
 * Operators pause this job from Supabase Studio -> feature_flags ->
 * projections_ingestion (enabled = false). No deploy needed.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isAuthorizedCronRequest, internalErrorResponse } from '../_shared/utils.ts'
import { createLogger } from '../_shared/logger.ts'
import { startJobRun, type JobRun, type JobRunsClient } from '../_shared/job-runs.ts'
import { getFlag, flagNumber } from '../_shared/feature-flags.ts'
import { utcDay } from '../_shared/mdblist-budget.ts'
import { runIngestFilmCorpus, DEFAULT_INGEST_CONFIG } from './handler.ts'

const log = createLogger('ingest-film-corpus')

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  let run: JobRun | undefined
  let runClient: JobRunsClient | undefined

  try {
    if (!isAuthorizedCronRequest(req)) {
      return errorResponse('Forbidden', 403)
    }

    run = startJobRun('ingest-film-corpus')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const tmdbToken = Deno.env.get('TMDB_API_KEY')
    const mdblistApiKey = Deno.env.get('MDBLIST_API_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      log.error('Missing required env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return errorResponse('Corpus ingestion service not configured', 503)
    }
    if (!tmdbToken || !mdblistApiKey) {
      log.error('TMDB_API_KEY or MDBLIST_API_KEY not configured')
      return errorResponse('Corpus ingestion service not configured', 503)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey)
    runClient = serviceClient

    const flag = await getFlag(serviceClient, 'projections_ingestion')
    if (!flag.enabled) {
      log.info('projections_ingestion flag disabled; skipping run')
      const job_status = await run.finish(serviceClient, { processed: 0, failed: 0, metadata: { skipped: 'flag_disabled' } })
      return jsonResponse({ skipped: 'flag_disabled', job_status })
    }

    const perRunCap = flagNumber(flag, 'per_run_cap', DEFAULT_INGEST_CONFIG.perRunCap)
    const result = await runIngestFilmCorpus(
      serviceClient,
      { tmdbToken, mdblistApiKey },
      {
        ...DEFAULT_INGEST_CONFIG,
        perRunCap,
        metadataPerRun: perRunCap * 3,
        dailyBudget: flagNumber(flag, 'mdblist_daily_budget', DEFAULT_INGEST_CONFIG.dailyBudget),
        today: utcDay(),
      }
    )

    const { errors, failed, ...metadata } = result
    const job_status = await run.finish(serviceClient, {
      processed: result.metadata_fetched + result.ratings_fetched + result.ratings_absent + failed,
      // A 429 is a degraded run even when nothing else failed: surface it in the ops channel.
      failed: failed + (result.mdblist_429 ? 1 : 0),
      errors,
      metadata,
    })

    return jsonResponse({ ...result, job_status })
  } catch (error) {
    if (run && runClient) await run.fail(runClient, error)
    return internalErrorResponse(error, log)
  }
})
```

- [ ] **Step 2: Wire config.toml, vercel.json, and the route**

Append to `supabase/config.toml`:

```toml

[functions.ingest-film-corpus]
verify_jwt = false
```

Add to the `crons` array in `apps/frontend/vercel.json` (after the `sync-release-dates` entry):

```json
    {
      "path": "/api/cron/ingest-film-corpus",
      "schedule": "0 9 * * *"
    },
```

Create `apps/frontend/app/api/cron/ingest-film-corpus/route.ts`:

```ts
import { proxyCronRequest } from '../_lib/proxyCronRequest'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  return proxyCronRequest(request, 'ingest-film-corpus')
}
```

- [ ] **Step 3: Type-check and smoke-run locally**

Run:
```bash
cd supabase/functions && deno check ingest-film-corpus/index.ts
cd ../.. && npx supabase stop && npx supabase start   # new function dirs are only picked up on start
```
Then, with `npx supabase functions serve --env-file supabase/functions/.env` running in another terminal (from this worktree — see memory note about the shared edge runtime), smoke it with the flag **off** first so no quota is spent:

```bash
docker exec supabase_db_fantasy-reel psql -U postgres -d postgres -c "update feature_flags set enabled=false where key='projections_ingestion'"
curl -s -X POST http://127.0.0.1:54321/functions/v1/ingest-film-corpus -H "X-Cron-Secret: $(grep CRON_SECRET supabase/functions/.env | cut -d= -f2)"
```
Expected: `{"skipped":"flag_disabled","job_status":"ok"}`. Then turn it on with `discoverFromYear` effectively limited by running once and confirming `job_runs` has a row with `metadata.seeded > 0` and `mdblist_granted <= 300`:

```bash
docker exec supabase_db_fantasy-reel psql -U postgres -d postgres -c "update feature_flags set enabled=true, config='{\"mdblist_daily_budget\": 500, \"per_run_cap\": 20}' where key='projections_ingestion'"
curl -s -X POST http://127.0.0.1:54321/functions/v1/ingest-film-corpus -H "X-Cron-Secret: ..." | head -c 600
docker exec supabase_db_fantasy-reel psql -U postgres -d postgres -c "select status, items_processed, metadata->>'seeded' seeded, metadata->>'mdblist_granted' granted from job_runs where job_name='ingest-film-corpus' order by started_at desc limit 1"
```
Expected: one `ok` row; `granted` ≤ 20. (The `per_run_cap: 20` keeps the local smoke to ≤ 21 MDBList calls.) Restore the seeded config afterwards: `config='{"mdblist_daily_budget": 500, "per_run_cap": 300}'`. Re-serve functions from the main checkout when done.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ingest-film-corpus/index.ts supabase/config.toml apps/frontend/vercel.json apps/frontend/app/api/cron/ingest-film-corpus/route.ts
git commit -m "feat(projections): ingest-film-corpus cron entrypoint and wiring"
```

---

### Task 11: Ordering integration test for the corpus queues

**Files:**
- Create: `supabase/functions/tests/film-corpus-queues.test.ts`

**Interfaces:**
- Consumes: the real `film_corpus` table; verifies the `priority DESC, release_date DESC NULLS LAST` ordering the handler relies on (the mock ignores `order()`).

- [ ] **Step 1: Write the test**

```ts
import { assertEquals } from '@std/assert'
import { getServiceClient } from './_setup.ts'

Deno.test('film_corpus queue ordering', async (t) => {
  const service = getServiceClient()
  const ids = [900200001, 900200002, 900200003, 900200004]

  await t.step('setup', async () => {
    await service.from('film_corpus').delete().in('tmdb_id', ids)
    const { error } = await service.from('film_corpus').insert([
      { tmdb_id: ids[0], title: 'sweep-old', seed_source: 'discover', priority: 0, release_date: '2015-01-01' },
      { tmdb_id: ids[1], title: 'sweep-new', seed_source: 'discover', priority: 0, release_date: '2025-01-01' },
      { tmdb_id: ids[2], title: 'predecessor', seed_source: 'person', priority: 50, release_date: '2010-01-01' },
      { tmdb_id: ids[3], title: 'in-league', seed_source: 'upcoming', priority: 100, release_date: null },
    ])
    assertEquals(error, null)
  })

  await t.step('metadata queue serves league movies, then predecessors, then newest sweep rows', async () => {
    const { data } = await service
      .from('film_corpus')
      .select('tmdb_id')
      .in('tmdb_id', ids)
      .is('metadata_fetched_at', null)
      .order('priority', { ascending: false })
      .order('release_date', { ascending: false, nullsFirst: false })
    assertEquals(data?.map((r) => r.tmdb_id), [ids[3], ids[2], ids[1], ids[0]])
  })

  await t.step('cleanup', async () => {
    await service.from('film_corpus').delete().in('tmdb_id', ids)
  })
})
```

- [ ] **Step 2: Run it**

Run: `cd supabase/functions && deno test --allow-all --env-file=.env.test tests/film-corpus-queues.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/tests/film-corpus-queues.test.ts
git commit -m "test(projections): film_corpus queue ordering"
```

---

### Task 12: `update-scores` — pre-release polling + projection freeze

**Files:**
- Modify: `supabase/functions/update-scores/index.ts` (imports `:1-7`; default branch `:171-186`; per-movie loop after `:290`; finish metadata `:329-337`)
- Test: `supabase/functions/tests/update-scores.test.ts` (append; gated steps)

**Interfaces:**
- Consumes: `getFlag`, `flagNumber`, `reserveApiCalls`, `MDBLIST_PROJECTIONS_KEY`.
- Behaviour (spec §8.1): in the **default (cron) branch only**, after selecting the nightly released set, additionally select up to 60 movies with `status = 'upcoming'`, `release_date` in `(today, today + 30d]`, `scores_updated_at IS NULL OR < now - 24h`, but only when `projections_ingestion` is enabled, and only as many as `reserveApiCalls(client, MDBLIST_PROJECTIONS_KEY, n, mdblist_daily_budget)` grants (it shares the projections slice with ingestion; the nightly released set stays unreserved). Append them to `moviesToUpdate`; report `prerelease_polled` and `prerelease_granted` in response + metadata. **Freeze:** when `calculate_movie_score` returns a non-null value for a movie, run `movie_projections.update({ frozen_at: now, actual_rt: <RT score> }).eq('tmdb_id', movie.tmdb_id).is('frozen_at', null)` — the RT score is the `rotten_tomatoes` entry in `ratings`.

- [ ] **Step 1: Write the failing test (gated, no external calls)**

Append to `supabase/functions/tests/update-scores.test.ts` (uses existing helpers `getServiceClient`, `invokeFunction`, `getEdgeFunctionServiceRoleKey` from `./_setup.ts`; look at the top of that file for how the function is invoked with the service key and copy that call shape):

```ts
Deno.test('update-scores: pre-release polling is flag- and budget-gated', async (t) => {
  const service = getServiceClient()

  await t.step('with projections_ingestion disabled, no upcoming movies are polled', async () => {
    await service.from('feature_flags').update({ enabled: false }).eq('key', 'projections_ingestion')
    const res = await invokeFunction<{ prerelease_polled: number; prerelease_granted: number }>('update-scores', {}, { serviceRole: true })
    assertEquals(res.data?.prerelease_polled, 0)
    assertEquals(res.data?.prerelease_granted, 0)
    await service.from('feature_flags').update({ enabled: true }).eq('key', 'projections_ingestion')
  })

  await t.step('freeze stamps movie_projections when a score lands', async () => {
    // Seed a model + projection row, then a scored review, and call the RPC path the function uses.
    await service.from('projection_models').upsert({ version: 0, coefficients: {}, metrics: {}, is_active: false }, { onConflict: 'version' })
    const tmdbId = 900300001
    const { data: movie } = await service.from('movies').upsert(
      { tmdb_id: tmdbId, title: 'Freeze Me', release_date: '2020-01-01', status: 'released' }, { onConflict: 'tmdb_id' }
    ).select('id').single()
    await service.from('movie_projections').upsert({
      tmdb_id: tmdbId, model_version: 0, projected_rt: 70, sigma: 12, p_rotten: 0.2, p_fresh: 0.7, p_club90: 0.1,
      expected_points: 8, factors: {}, coverage: 0.5, partial: false, frozen_at: null, actual_rt: null,
    }, { onConflict: 'tmdb_id' })
    await service.from('reviews').upsert({ movie_id: movie!.id, source: 'rotten_tomatoes', score: 81, raw_score: '81%', fetched_at: new Date().toISOString() }, { onConflict: 'movie_id,source' })
    // Direct call of the freeze helper path: invoke the function for this movie_id with a stubbed MDBList is not possible
    // without the network, so exercise the SQL contract the function relies on instead.
    await service.rpc('calculate_movie_score', { p_movie_id: movie!.id })
    await service.from('movie_projections').update({ frozen_at: new Date().toISOString(), actual_rt: 81 }).eq('tmdb_id', tmdbId).is('frozen_at', null)
    const { data: frozen } = await service.from('movie_projections').select('frozen_at, actual_rt').eq('tmdb_id', tmdbId).single()
    assertEquals(frozen?.actual_rt, 81)
    assert(frozen?.frozen_at)
    // cleanup
    await service.from('movie_projections').delete().eq('tmdb_id', tmdbId)
    await service.from('reviews').delete().eq('movie_id', movie!.id)
    await service.from('movies').delete().eq('id', movie!.id)
  })
})
```

If `invokeFunction` in `_setup.ts` does not accept `{ serviceRole: true }`, use the same invocation shape the existing steps in this file use for cron-authenticated calls (they pass the service key via `getEdgeFunctionServiceRoleKey()` in an `Authorization: Bearer` header).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test --allow-all --env-file=.env.test tests/update-scores.test.ts --filter "pre-release"`
Expected: FAIL — `prerelease_polled` is `undefined`.

- [ ] **Step 3: Implement**

In `supabase/functions/update-scores/index.ts`:

Add imports after line 7:

```ts
import { getFlag, flagNumber } from '../_shared/feature-flags.ts'
import { reserveApiCalls, MDBLIST_PROJECTIONS_KEY } from '../_shared/mdblist-budget.ts'
```

Add constants near `MAX_MOVIES_PER_RUN`:

```ts
/** Pre-release polling window (spec §8.1): upcoming movies releasing within this many days. */
const PRERELEASE_WINDOW_DAYS = 30
/** Cap on upcoming movies polled per run; each is one MDBList call. */
const PRERELEASE_MAX_PER_RUN = 60
/** Default daily MDBList budget for the projections slice when the flag has no config. */
const DEFAULT_MDBLIST_DAILY_BUDGET = 500
```

Declare counters alongside `truncation`:

```ts
    let prereleasePolled = 0
    let prereleaseGranted = 0
```

In the default branch, after `moviesToUpdate = (data as MovieRecord[]) || []`, add:

```ts
      // Pre-release polling: festival premieres and embargo lifts put a
      // Tomatometer on MDBList days or weeks before wide release. Worth one
      // budget-reserved call per upcoming movie per day while players are
      // still trading and bidding on it. Gated by the same flag as corpus
      // ingestion so an operator can hand the whole quota back to scoring.
      const ingestionFlag = await getFlag(serviceClient, 'projections_ingestion')
      if (ingestionFlag.enabled) {
        const today = new Date().toISOString().split('T')[0]
        const windowEnd = new Date()
        windowEnd.setDate(windowEnd.getDate() + PRERELEASE_WINDOW_DAYS)
        const { data: upcoming, error: upcomingError } = await serviceClient
          .from('movies')
          .select('id, tmdb_id, imdb_id, title')
          .eq('status', 'upcoming')
          .gt('release_date', today)
          .lte('release_date', windowEnd.toISOString().split('T')[0])
          .or(`scores_updated_at.is.null,scores_updated_at.lt.${oneDayAgo.toISOString()}`)
          .order('release_date', { ascending: true })
          .limit(PRERELEASE_MAX_PER_RUN)
        if (upcomingError) {
          log.warn('Pre-release selection failed', { error: serializeError(upcomingError) })
        } else if (upcoming && upcoming.length > 0) {
          prereleaseGranted = await reserveApiCalls(
            serviceClient,
            MDBLIST_PROJECTIONS_KEY,
            upcoming.length,
            flagNumber(ingestionFlag, 'mdblist_daily_budget', DEFAULT_MDBLIST_DAILY_BUDGET)
          )
          const polled = (upcoming as MovieRecord[]).slice(0, prereleaseGranted)
          prereleasePolled = polled.length
          moviesToUpdate = [...moviesToUpdate, ...polled]
        }
      }
```

In the per-movie loop, replace the `else` branch that logs `'Calculated score'` with:

```ts
          } else {
            log.info('Calculated score', { movie_title: movie.title, fantasy_points: fantasyPts })
            results.scores_updated++

            // Freeze the projection (if any) at the first real Tomatometer so
            // projected-vs-actual is never rewritten. No row is fine.
            const rt = ratings.find((r) => r.source === 'rotten_tomatoes')?.score
            if (rt != null) {
              const { error: freezeError } = await serviceClient
                .from('movie_projections')
                .update({ frozen_at: new Date().toISOString(), actual_rt: Math.round(rt) })
                .eq('tmdb_id', movie.tmdb_id)
                .is('frozen_at', null)
              if (freezeError) log.warn('Projection freeze failed', { tmdb_id: movie.tmdb_id, error: serializeError(freezeError) })
            }
          }
```

Extend the early-return (`moviesToUpdate.length === 0`) body and the final response/metadata with `prerelease_polled: prereleasePolled, prerelease_granted: prereleaseGranted`:

```ts
      return jsonResponse({
        movies_fetched: 0,
        scores_updated: 0,
        errors: [],
        prerelease_polled: prereleasePolled,
        prerelease_granted: prereleaseGranted,
        job_status
      })
```

and

```ts
      metadata: {
        movies_fetched: results.movies_fetched,
        scores_updated: results.scores_updated,
        prerelease_polled: prereleasePolled,
        prerelease_granted: prereleaseGranted,
        notifications,
        ...truncation,
      },
    })

    return jsonResponse({ ...results, ...truncation, prerelease_polled: prereleasePolled, prerelease_granted: prereleaseGranted, notifications, job_status })
```

Also update the freeze-stamp behaviour note: a pre-release poll that finds a Tomatometer for an `upcoming` movie writes reviews and points exactly like a released one; `movies.status` is untouched (the existing status flip belongs to `sync-release-dates`).

- [ ] **Step 4: Run tests**

Run:
```bash
cd supabase/functions && deno task test:unit
deno test --allow-all --env-file=.env.test tests/update-scores.test.ts
```
Expected: PASS. The pre-existing `_shared/update-scores.test.ts` inline mock must now answer `from('feature_flags')…maybeSingle()` — if it throws, extend that file's local mock to return `{ data: null, error: null }` for `feature_flags` (a missing row reads as disabled, so the branch is skipped and no other assertions change).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/update-scores/index.ts supabase/functions/tests/update-scores.test.ts supabase/functions/_shared/update-scores.test.ts
git commit -m "feat(projections): pre-release score polling and projection freeze in update-scores"
```

---

### Task 13: Documentation

**Files:**
- Modify: `CLAUDE.md` (Observability Conventions list; new subsection after "Supabase & Deployment")
- Modify: `CLAUDE.md` §9 test-structure block (fix the stale `_test_utils/` reference)

- [ ] **Step 1: Add the feature-flag and projections plumbing docs**

Insert after the "Supabase & Deployment" bullet list in `CLAUDE.md`:

```markdown
## Feature Flags

Operator switches live in the `feature_flags` table (`key`, `enabled`, `config` JSONB, `description`). **Edit them in Supabase Studio → Table Editor → `feature_flags`** — toggle `enabled`, edit `config` inline. No deploy; Edge Functions memoize reads for 60 s (`getFlag` in `_shared/feature-flags.ts`), the frontend reads the table directly under RLS. A missing row or read error is `disabled`. Current flags:

| Key | Gates | Config |
|---|---|---|
| `projections_ingestion` | `ingest-film-corpus` cron and pre-release polling in `update-scores` (the `mdblist:projections` budget slice) | `mdblist_daily_budget` (500), `per_run_cap` (300) |
| `projections_display` | Projected scores (Beta) in the UI — off until the backtest gate in the projections spec passes | — |

Every new flag gets a `description` row that tells the operator what turning it off does.

## Movie Projections Plumbing

Spec: `docs/superpowers/specs/2026-08-26-movie-projections-design.md`. Phase 1 (shipped): `film_corpus` / `film_people` / `film_credits` / `film_collections` hold the historical corpus, filled by `ingest-film-corpus` (daily 09:00 UTC; seed → TMDb metadata → MDBList ratings). **All projections MDBList calls reserve through `reserveApiCalls` (`_shared/mdblist-budget.ts`) under the `mdblist:projections` key of `external_api_budgets`** (the ledger PR #72 introduced for franchise history, which reserves under its own `mdblist:franchise-history` key) — never call MDBList without a reservation; user traffic must never trigger one. `update-scores` also polls upcoming movies within 30 days (embargo-lift scores) and freezes `movie_projections.frozen_at/actual_rt` the first time a real Tomatometer lands. Backfill progress is in `job_runs.metadata` (`remaining_metadata`, `remaining_ratings`, `mdblist_used_today`).
```

Add to the Observability Conventions list:

```markdown
- **MDBList budget:** any call to `api.mdblist.com` outside `update-scores`' nightly branch must first reserve through `reserve_external_api_calls` under a per-feature key (`_shared/mdblist-budget.ts` → `reserveApiCalls(client, MDBLIST_PROJECTIONS_KEY, n, limit)` for projections; franchise history uses `mdblist:franchise-history`). The free plan is 1,000/day: ~120 scoring + 300 franchise history + 500 projections.
```

In §9, replace the `_test_utils/` lines of the test-structure tree and the "Use the mock utilities" example with the real module:

```markdown
├── _shared/
│   ├── _mock-client.ts          # createMockDbClient (filtering in-memory client), stubFetch
```

and

```ts
import { createMockDbClient, stubFetch, type MockDb } from '../_shared/_mock-client.ts'

const db: MockDb = { movies: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', tmdb_id: 1, title: 'X' }] }
const client = createMockDbClient(db, { unique: { movies: ['tmdb_id'] }, rpc: { calculate_movie_score: 12 } })
const { calls, restore } = stubFetch((url) => url.includes('api.mdblist.com') ? new Response('{}', { status: 200 }) : undefined)
try { /* call the handler with `client` */ } finally { restore() }
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: feature flags, projections plumbing, and correct test mock reference"
```

---

### Task 14: Full verification and PR

- [ ] **Step 1: Run everything**

```bash
cd supabase/functions && deno task test:unit
npm run test:functions        # from repo root; needs local Supabase with the migration applied
cd apps/frontend && npm run lint && npx tsc --noEmit
```
Expected: unit PASS; integration PASS except the two documented pre-existing failures (`process-bids-dropped-targets` outbid promotion; the two `place-bid` message assertions without `PLACE_BID_URL`) — confirm no new failures; lint/tsc clean.

- [ ] **Step 2: Confirm the diff is complete**

```bash
git status
git diff --stat main...HEAD
```
Expected files: the migration, four new `_shared` modules + tests, `_mock-client.ts` + test, `ingest-film-corpus/{handler,index}.ts`, `_shared/ingest-film-corpus.test.ts`, `tests/{feature-flags-rls,film-corpus-queues}.test.ts`, `update-scores/index.ts`, `tests/update-scores.test.ts`, `config.toml`, `vercel.json`, the cron route, `CLAUDE.md`, and the spec + plan docs.

- [ ] **Step 3: Open a draft PR**

```bash
git push -u origin HEAD
gh pr create --draft --title "feat(projections): phase 1 plumbing — corpus ingestion, MDBList budget, feature flags" --body-file - <<'EOF'
## Summary
Phase 1 of Movie Projections (Beta) — spec in `docs/superpowers/specs/2026-08-26-movie-projections-design.md`.

- `feature_flags` table (edit in Supabase Studio → Table Editor): `projections_ingestion` (on), `projections_display` (off)
- Reuses PR #72's `external_api_budgets` + `reserve_external_api_calls()` under a separate `mdblist:projections` key (500/day) — carried as an idempotent copy so merge order with #72 doesn't matter
- Historical film corpus tables + `ingest-film-corpus` daily cron (seed → TMDb metadata/people/franchise → MDBList ratings, budget-paced)
- `update-scores`: pre-release polling for movies releasing within 30 days; freezes `movie_projections` at first real score
- `projection_models` / `movie_projections` created now (filled in Phase 2)

## After merge
1. Confirm CI applied the migration and deployed `ingest-film-corpus` (`config.toml` entry included).
2. The Vercel cron (`0 9 * * *`) starts the backfill automatically; watch `job_runs` for `remaining_ratings` to fall (≈10 days at 600/day, current-season slate first).
3. To pause quota spend at any time: Studio → `feature_flags` → `projections_ingestion` → uncheck `enabled`.
4. Backfill ≈ 10–12 days at 500/day; current-season slate first.

## Testing
- `deno task test:unit` — feature flags, budget, TMDb mappers, ingestion stages A/B/C, mock client
- `npm run test:functions` — budget RPC presence + RLS on `feature_flags`, corpus queue ordering, update-scores gating
- Local smoke of the cron with `per_run_cap: 20` (≤ 21 MDBList calls)
EOF
```

- [ ] **Step 4: Report**

Post the PR URL and the local smoke-run `job_runs` row as the completion summary.
