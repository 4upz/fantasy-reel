# Movie Projections (Beta) — Design

**Date:** 2026-08-26
**Status:** Draft for review
**Scope:** A projected Rotten Tomatoes score and expected fantasy points for
unreleased movies, computed from the film's people, franchise, studio, and
genre history; a budget-paced corpus ingestion pipeline; a Supabase-backed
feature-flag table with a Studio editing workflow; and Beta-labelled UI
surfaces.

---

## 1. Goal and non-goals

### Goal

Give players a **defensible, explainable estimate** of how an unreleased movie
will score, so drafting, bidding, and trading decisions are informed by more
than title recognition. Every projection must show *why* — the factors and the
sample sizes behind it — and must be labelled **Beta** everywhere it appears.

### Why not Fantasy Critic's approach

Fantasy Critic's "projected score" is a three-term linear regression on its
own community's draft behaviour (percent of leagues that drafted a game, its
counter-pick rate, and average draft position; see `HypeFactorService.cs` in
their repo). It uses no content metadata and needs thousands of leagues to
have signal. We have a handful of leagues, but — unlike games — movies have a
rich, public history for every director, writer, actor, franchise, and studio,
reachable through the two APIs we already integrate. That history is the model.

What we do borrow from Fantasy Critic: refit constants from data on a schedule
with hard-coded fallbacks; freeze a projection at the moment the real score
lands; and record our own crowd signals (draft position, bid totals,
counterpick rate) now so they can become features once volume exists.

### Non-goals (v1)

- No composite "trade fairness" grade. (A separate, later feature; it gains
  value once `expected_points` exists for unreleased movies.)
- No LLM-generated commentary.
- No Discord bot parity. The bot's movie/roster/top-available commands are
  the natural follow-up; listed in §12.
- No per-league opt-out toggle. The global display flag is the only switch.
- No renaming or restructuring of `movies`; the corpus is a separate table.

---

## 2. Facts the design depends on (verified 2026-08-26)

**MDBList** (`api.mdblist.com`): Free plan, **1,000 requests/day**, 79 used
today. `GET /tmdb/movie/{tmdb_id}` returns ratings with sources `imdb`,
`tomatoes`, `metacritic` (each `{ source, value, score, votes }`), plus
`budget`, `revenue`, `production_companies`, `certification`, `released`,
`released_digital`, `genres`. `GET /user` reports `api_requests` (cap) and
`api_requests_count` (used today) — the ingestion job reads this rather than
trusting a constant.

**TMDb** (v4 bearer, ~50 req/s, no daily cap):
- `GET /movie/{id}?append_to_response=credits,keywords,release_dates` — one
  call yields `belongs_to_collection`, `budget`, `runtime`,
  `production_companies`, crew with `job`, cast with billing `order`, and US
  release types (3 = wide theatrical, 2 = limited) with certification.
- `GET /collection/{id}` — every franchise entry with release dates.
- `GET /person/{id}/movie_credits` — full filmography with `job` and dates.
- `GET /discover/movie?region=US&with_release_type=3&primary_release_date.gte=…&vote_count.gte=…`
  — 2024 alone returns 572 films at `vote_count ≥ 100`; the seed set below
  uses a tighter threshold.

**Production MDBList draw today:** `update-scores` runs at 06:00 and 18:00
UTC with `.limit(30)` on the nightly branch → ≤ 60 calls/day, usually far
fewer. `sync-release-dates` is TMDb-only.

**Scoring curve** exists only as plpgsql `calculate_movie_score(UUID)`
(`20260802000000_rt_only_scoring.sql`). No TypeScript implementation exists.

**Repo conventions used here:** cron entrypoints keep logic in a sibling
`handler.ts` exercised by `_shared/*.test.ts` through `_mock-client.ts`
(`createMockDbClient`, `stubFetch`); `startJobRun` / `run.finish` /
`run.fail` from `_shared/job-runs.ts`; `proxyCronRequest` route stubs under
`apps/frontend/app/api/cron/<name>/route.ts`; `vercel.json` cron entries;
`config.toml` `verify_jwt = false` per function; service-role-only tables
enable RLS with no policies (`tmdb_cache` migration is the template); the
frontend has no unit runner, so all model math lives in `_shared/` and is
Deno-tested.

---

## 3. Architecture overview

```
                 TMDb (people, collections, discover, details)
                          │
   ┌──────────────────────▼──────────────────────┐
   │ ingest-film-corpus (cron, daily)            │  MDBList ratings for
   │   seed → credits → ratings (budget-paced)   │◄─ historical films
   └──────────────────────┬──────────────────────┘  (external_api_budgets)
                          ▼
        film_corpus · film_people · film_credits · film_collections
                          │
   ┌──────────────────────▼──────────────────────┐
   │ fit-projection-model (cron, weekly)         │
   │   leave-year-out backtest → coefficients    │──► projection_models
   └──────────────────────┬──────────────────────┘
                          ▼
   ┌─────────────────────────────────────────────┐
   │ get-movie-projections (on demand, user)     │──► movie_projections (cache)
   │   pure compute from corpus; TMDb only for   │
   │   the target movie; never calls MDBList     │
   └──────────────────────┬──────────────────────┘
                          ▼
          Frontend: ProjectionChip (Beta) + ProjectionBreakdown
                 gated by feature_flags.projections_display
```

Two rules make the quota safe:

1. **User traffic never spends MDBList.** On-demand projection requests
   compute from what is already in the corpus. Gaps are *enqueued* for the
   paced job (by inserting stub `film_corpus` rows) — never fetched inline.
2. **A per-feature daily budget.** Every projections MDBList call reserves
   through `_shared/mdblist-budget.ts` → `reserve_external_api_calls`
   under the `mdblist:projections` key (§4.2). Scoring is first in line by
   schedule, pre-release polling second, backfill last.

---

## 4. Schema

All new tables are created in one migration, timestamp **after**
`20260827130000` (PR #72's, renamed from `…120000` after a collision with
another branch; ours is `20260828120000` — check for collisions before merge,
duplicates are skipped silently).

### 4.1 `feature_flags`

```sql
CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read feature flags"
  ON feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage feature flags"
  ON feature_flags FOR ALL USING (auth.role() = 'service_role');
```

Seed rows:

| key | enabled | config | description |
|---|---|---|---|
| `projections_ingestion` | `false` | `{"mdblist_daily_budget": 500, "per_run_cap": 300}` | Corpus backfill and pre-release score polling may spend MDBList quota. Turn ON in Studio after the first supervised run; the ingest cron is a no-op while off. |
| `projections_display` | `false` | `{}` | Show projected scores (Beta) in the app. Stays off until the backtest gate in §9 passes. |

**Editing workflow (no SQL):** Supabase Studio → Table Editor →
`feature_flags` → click the `enabled` checkbox / edit `config` inline. The
`description` column is the operator's documentation. Changes take effect on
the next request (Edge Functions cache reads for 60 s in-isolate; the
frontend hook revalidates on focus).

Read helpers:
- `_shared/feature-flags.ts`: `getFlag(client, key): Promise<{ enabled, config }>`
  with a 60 s per-isolate memo; a missing row reads as `enabled: false`.
- `apps/frontend/hooks/useFeatureFlag.ts`: SWR over a direct Supabase select
  (RLS permits it), `dedupingInterval: 60_000`. Returns `{ enabled, config,
  isLoading }`; while loading, `enabled` is `false` so a chip never flashes.

### 4.2 Budget ledger — reuse `external_api_budgets` (PR #72)

The franchise-history feature (PR #72, `20260827130000_external_api_budgets.sql`)
already ships exactly this mechanism: `external_api_budgets(api, day, calls)`
plus `reserve_external_api_calls(p_api text, p_requested int, p_daily_limit int)
RETURNS int` — an atomic, row-locked per-UTC-day grant, service-role only.
**Projections reuse it rather than adding a second ledger.**

Each feature reserves under its own `api` key with its own daily limit, so
one feature cannot consume another's slice:

| `api` key | Daily limit | Spender |
|---|---|---|
| `mdblist:franchise-history` | 300 (PR #72) | `get-franchise-history`, user-driven |
| `mdblist:projections` | 500 (`feature_flags.projections_ingestion.config.mdblist_daily_budget`) | `ingest-film-corpus`, pre-release polling in `update-scores` |
| *(unreserved)* | ≈ 60–120 | nightly scoring, first in line by schedule (06:00 / 18:00 UTC) |

Worst case 300 + 500 + 120 = 920 < 1,000. The ingestion job additionally
reconciles against MDBList's own `/user` counter before reserving, so a
day where scoring or manual use ran hot shrinks the projections slice
automatically.

Because PR #72 may merge before or after this work, the projections
migration carries an **idempotent copy** of the table and function
(`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, identical
definition, later timestamp). Whichever lands second is a no-op.

Follow-up for PR #72 (not in this scope): once `film_corpus` holds
Tomatometers for franchise entries, `get-franchise-history` can read them
there before spending MDBList — its lookups and ours target the same films.

### 4.3 Corpus

```sql
CREATE TABLE film_corpus (
  tmdb_id            integer PRIMARY KEY,
  title              text NOT NULL,
  release_date       date,
  collection_id      integer,
  genre_ids          integer[] NOT NULL DEFAULT '{}',
  company_ids        integer[] NOT NULL DEFAULT '{}',
  budget             bigint,
  runtime            integer,
  certification      text,
  us_release_type    smallint,           -- TMDb type: 2 limited, 3 wide
  vote_average       numeric(3,1),
  vote_count         integer,
  rt_critic          smallint,           -- Tomatometer, NULL until fetched/absent
  rt_critic_votes    integer,
  metacritic         smallint,
  imdb               numeric(3,1),
  metadata_fetched_at timestamptz,       -- TMDb details+credits done
  ratings_fetched_at  timestamptz,       -- MDBList done (even if RT absent)
  ratings_absent      boolean NOT NULL DEFAULT false,  -- MDBList 404 / no RT
  seed_source        text NOT NULL,      -- 'discover' | 'person' | 'collection' | 'upcoming'
  priority           smallint NOT NULL DEFAULT 0,      -- higher first
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_corpus_needs_metadata ON film_corpus (priority DESC, release_date DESC)
  WHERE metadata_fetched_at IS NULL;
CREATE INDEX idx_film_corpus_needs_ratings ON film_corpus (priority DESC, release_date DESC)
  WHERE ratings_fetched_at IS NULL;
CREATE INDEX idx_film_corpus_collection ON film_corpus (collection_id) WHERE collection_id IS NOT NULL;

CREATE TABLE film_people (
  tmdb_person_id integer PRIMARY KEY,
  name           text NOT NULL,
  credits_fetched_at timestamptz         -- /person/{id}/movie_credits done
);

CREATE TABLE film_credits (
  tmdb_id        integer NOT NULL REFERENCES film_corpus(tmdb_id) ON DELETE CASCADE,
  tmdb_person_id integer NOT NULL REFERENCES film_people(tmdb_person_id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('director', 'writer', 'cast')),
  billing        smallint,               -- cast order; NULL for crew
  PRIMARY KEY (tmdb_id, tmdb_person_id, role)
);
CREATE INDEX idx_film_credits_person ON film_credits (tmdb_person_id, role);

CREATE TABLE film_collections (
  collection_id integer PRIMARY KEY,
  name          text NOT NULL,
  parts_fetched_at timestamptz
);
```

All four: RLS on, no policies (service role only). Ratings are immutable
once fetched for films released more than 60 days ago; the ingestion job
never re-polls them.

### 4.4 Projections

```sql
CREATE TABLE projection_models (
  version      integer PRIMARY KEY,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  coefficients jsonb NOT NULL,  -- see §6.4
  metrics      jsonb NOT NULL,  -- backtest MAE, spearman, calibration, n
  is_active    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX idx_projection_models_active ON projection_models (is_active) WHERE is_active;

CREATE TABLE movie_projections (
  tmdb_id          integer PRIMARY KEY,
  model_version    integer NOT NULL REFERENCES projection_models(version),
  projected_rt     numeric(4,1) NOT NULL,
  sigma            numeric(4,1) NOT NULL,   -- residual std used for the distribution
  p_rotten         numeric(4,3) NOT NULL,   -- P(RT < 60)
  p_fresh          numeric(4,3) NOT NULL,   -- P(60 ≤ RT < 90)
  p_club90         numeric(4,3) NOT NULL,   -- P(RT ≥ 90)
  expected_points  numeric(6,2) NOT NULL,
  factors          jsonb NOT NULL,          -- see §6.5 (user-facing breakdown)
  coverage         numeric(3,2) NOT NULL,   -- 0–1 share of factor weight backed by data
  partial          boolean NOT NULL,        -- corpus gaps still queued
  computed_at      timestamptz NOT NULL DEFAULT now(),
  frozen_at        timestamptz,             -- set when the real RT score first lands
  actual_rt        smallint                 -- copied at freeze for projected-vs-actual
);
ALTER TABLE movie_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read projections"
  ON movie_projections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage projections"
  ON movie_projections FOR ALL USING (auth.role() = 'service_role');
```

`movie_projections` is readable by any signed-in user because it contains
nothing league-specific; the frontend may select from it directly for cached
rows, and only calls the Edge Function for misses or stale rows.

### 4.5 Crowd-signal columns (record now, use later)

Add nullable `draft_position_avg numeric(5,2)`, `bid_total integer`,
`counterpick_count integer`, `signals_updated_at timestamptz` to
`movie_projections`. `fit-projection-model` fills them from
`draft_picks`, `pickup_bids`, and `counterpicks` across all leagues. They are
**not** model inputs until at least 30 leagues have completed a season; the
fit job logs their correlation with actuals each run so we know when they
become useful.

---

## 5. Ingestion: `ingest-film-corpus`

Cron: `vercel.json` → `/api/cron/ingest-film-corpus` at `0 9 * * *` (after
the 06:00 score sync and the 08:00 release-date sync, so scoring has first
claim on the day's quota). Route stub + `config.toml` entry like every other
cron. Entrypoint follows `sync-release-dates/index.ts` exactly; logic in
`ingest-film-corpus/handler.ts`.

### 5.1 Gate

```
flag = getFlag('projections_ingestion')
if (!flag.enabled) → finish({ processed: 0, metadata: { skipped: 'flag_disabled' } })
```

### 5.2 Stage A — seed (TMDb only, idempotent)

Insert stub `film_corpus` rows (`seed_source`, `title`, `release_date`,
`vote_count`, `priority`) for:

1. **Historical wide releases**: `/discover/movie` for each year 2012 →
   current, `region=US`, `with_release_type=3`, `vote_count.gte=300`,
   `language=en-US`, all pages. ≈ 150–250/year → **~2,500–3,000 films**.
   Runs once per year-bucket; a `film_corpus_seed_progress` row per year is
   unnecessary — the job simply re-runs discover for any year whose stub
   count is below 50 and relies on `ON CONFLICT DO NOTHING`.
2. **Upcoming and rostered movies**: every `movies` row with
   `status = 'upcoming'` or `release_date >= today - 60d` gets a row with
   `seed_source = 'upcoming'`, `priority = 100`.
3. **Predecessors of upcoming movies**: for each upcoming movie whose
   `metadata_fetched_at` is set, every prior film of its director(s),
   writer(s), top-3 cast, and collection that is not yet in the corpus, with
   `priority = 50`. This is what makes projections for *this season's* slate
   complete first.

### 5.3 Stage B — metadata (TMDb only)

For up to `per_run_cap * 3` rows (TMDb is cheap) ordered by
`idx_film_corpus_needs_metadata`: fetch
`/movie/{id}?append_to_response=credits,release_dates`, write corpus columns,
upsert `film_people` for director(s), writer(s) (`job IN ('Screenplay',
'Writer', 'Story')`), and cast with `order < 5`; insert `film_credits`; upsert
`film_collections`. Stamp `metadata_fetched_at`. Then, for each `film_people`
row lacking `credits_fetched_at` that is referenced by a `priority >= 50`
film: fetch `/person/{id}/movie_credits`, insert stub corpus rows for prior
films with `vote_count >= 100`, stamp. Same for `film_collections` parts.

All TMDb calls go through `tmdbGetJson` (already retry/timeout-wrapped) —
not `cachedTmdbFetch`, because these payloads are consumed once and persisted.

### 5.4 Stage C — ratings (MDBList, budget-paced)

```
cap      = flag.config.mdblist_daily_budget   (default 500)
perRun   = flag.config.per_run_cap            (default 300)
remote   = GET /user → api_requests_count      (1 call; counted)
headroom = min(perRun, cap - 1, 1000 - remote - 100)   -- keep 100 for the evening score sync
granted  = reserve_external_api_calls('mdblist:projections', headroom, cap)
```

Fetch ratings for `granted` rows ordered by `idx_film_corpus_needs_ratings`,
via the existing `fetchMDBListRatings` (add an optional `rawPayload`
return so budget/revenue/certification can be stored without a second
call). Write `rt_critic` (`tomatoes`), `rt_critic_votes`, `metacritic`,
`imdb`, stamp `ratings_fetched_at`; a 404 or a payload without `tomatoes`
sets `ratings_absent = true` (still stamped — never retried).

A 429 from MDBList aborts Stage C for the run, records
`metadata.mdblist_429 = true`, and finishes as `partial` so `alertOps` fires.

### 5.5 Outcome

`run.finish(client, { processed, failed, metadata: { seeded, metadata_fetched,
ratings_fetched, ratings_absent, remaining_metadata, remaining_ratings,
mdblist_used_today, budget_cap } })`. `remaining_*` in-band, per the
`update-scores` truncation convention, so the ops channel can see backfill
progress without querying.

**Expected backfill duration:** the first real seed produced ~6,200 discover
stubs at `vote_count >= 300`, plus predecessors; expect **20+ days at 500/day**,
with the current season complete in the first few days because of priority
order. Raise `mdblist_daily_budget` in Studio (up to ~600 while franchise
history stays under 300) or raise the vote floor to shorten it.

---

## 6. The model

Pure TypeScript in `_shared/projection-model.ts`, **no Supabase calls**,
same discipline as `_shared/bid-resolution.ts`. Input is a plain
`ProjectionInput` object assembled by the caller; output is a
`Projection`. Deno-tested with table-driven fixtures.

### 6.1 Scoring curve mirror

`_shared/scoring-curve.ts` exports `rtToFantasyPoints(rt: number): number`
mirroring `calculate_movie_score` exactly (90+ → `30 + 2·(rt−90)`; 50–89 →
`rt − 60`; below 50 the slope halves each 10 points). Its test file
asserts the seven documented tier examples from CLAUDE.md §5, and a comment
on the SQL function points at the TS mirror (same convention as
`validate_trade_items()` ↔ `trade-validation.ts`). This is the one
deliberate duplication in the design.

### 6.2 Factors

Each factor produces `(mean, n, recencyWeightedMean)` from prior films'
`rt_critic`, considering only films released **before the target's release
date** (leak-proof for backtesting):

| Factor | Population | Notes |
|---|---|---|
| `franchise` | other films in `collection_id`, released earlier | last entry weighted 2×; also emits `sequel_index` (position in the series) |
| `director` | films where any target director is credited `director` | last 5 by date, recency-weighted (weights 1.0, 0.8, 0.6, 0.5, 0.4) |
| `writer` | same for writers | last 5 |
| `cast` | films where any of the target's top-3 cast appear with `billing < 5` | last 8, pooled across the three |
| `studio` | films sharing any `company_ids`, last 6 years | major studios have hundreds; indies few |
| `genre_year` | films sharing the target's primary genre, released in the 3 calendar years before target's year | always available — this is the prior |

Shrinkage: every factor is pulled toward the `genre_year` mean with
`k = 3` pseudo-observations:
`adj = (n·mean + k·prior) / (n + k)`. A factor with `n = 0` contributes
exactly the prior (and zero coverage).

### 6.3 Blend

`projected_rt = β₀ + Σ βᵢ · adjᵢ + β_seq · min(sequel_index, 4) + β_type · [us_release_type = 2]`

Coefficients `β` come from the active `projection_models` row (ridge
regression fitted in §7), with a hard-coded fallback set in
`projection-model.ts` (derived from the first backtest and committed with
it, FC-style) used when no active model row exists.

`coverage = Σ |βᵢ| · [nᵢ > 0] / Σ |βᵢ|` — the share of model weight backed by
actual observations.

### 6.4 Distribution and expected points

Residuals from the backtest are grouped into three coverage bands
(`< 0.4`, `0.4–0.75`, `≥ 0.75`); each band's residual standard deviation is
stored in `coefficients.sigma_by_band`. The projection uses a normal
`N(projected_rt, σ_band)` clipped to `[0, 100]`:

- `p_rotten = Φ((60 − μ)/σ)`, `p_club90 = 1 − Φ((90 − μ)/σ)`,
  `p_fresh = 1 − p_rotten − p_club90`
- `expected_points = Σ_{rt=0..100} P(rt) · rtToFantasyPoints(rt)` — a
  discrete integral over 1-point bins.

The nonlinear curve makes `expected_points ≠ rtToFantasyPoints(projected_rt)`;
the integral is the honest number, and the three probabilities are what
users see first.

### 6.5 `factors` JSON (user-facing)

```json
{
  "genre_year":  { "label": "Sci-fi, 2023–2025", "mean": 64, "n": 41 },
  "franchise":   { "label": "Dune", "mean": 87, "n": 2, "last": { "title": "Dune: Part Two", "rt": 92 } },
  "director":    { "label": "Denis Villeneuve", "mean": 88, "n": 5, "last": { "title": "Dune: Part Two", "rt": 92 } },
  "writer":      { "label": "2 writers", "mean": 84, "n": 5 },
  "cast":        { "label": "Chalamet, Zendaya, Ferguson", "mean": 78, "n": 8 },
  "studio":      { "label": "Legendary", "mean": 66, "n": 23 },
  "sequel_index": 3,
  "missing":     []
}
```

`missing` lists factors whose prior films are still queued for ingestion
(`partial = true` when non-empty). Labels are prebuilt server-side so the
frontend renders strings, not IDs.

---

## 7. Fitting: `fit-projection-model`

Cron weekly, `0 10 * * 1` (Monday, after ingestion). TMDb/MDBList calls:
**none**. Steps:

1. Load every `film_corpus` row with `rt_critic IS NOT NULL` and
   `us_release_type = 3`, 2015 → last complete year (2012–2014 exist only as
   history for the earliest training rows).
2. Build `ProjectionInput` for each (features from earlier films only).
3. **Leave-one-year-out backtest**: for each year Y in 2019 → last complete
   year, fit ridge (λ = 1) on all other years, predict Y. Aggregate MAE,
   Spearman ρ, bucket calibration (predicted vs. observed P(rotten),
   P(club90) in deciles), and residual σ per coverage band.
4. Fit the final model on all years. Insert `projection_models` with
   `metrics`, `is_active = true` **only if** ρ ≥ 0.40 and MAE ≤ 16; otherwise
   insert with `is_active = false`, finish `partial`, and let `alertOps`
   say so. The previous active model stays active.
5. Recompute `movie_projections` for every unfrozen row (upcoming movies)
   under the new model. Update crowd-signal columns (§4.5).

The ridge solve is a small normal-equations implementation in
`_shared/ridge.ts` (~8 features; no dependency). Unit-tested against a
known dataset.

The one-off **backtest gate** (§9) is the same code run manually before the
display flag is ever turned on.

---

## 8. Serving: `get-movie-projections`

`POST /functions/v1/get-movie-projections` `{ tmdb_ids: number[] }` (max
50). Auth: `authenticateUserOrServiceRole`. Response:

```ts
{ projections: Record<number, Projection | null>, display_enabled: boolean }
```

`Projection` = the `movie_projections` row minus internal columns, plus
`beta: true` (a constant, so the client cannot forget the label).

Per id:
1. Cached row with `computed_at` < 24 h old and `partial = false` → return.
2. Otherwise assemble `ProjectionInput` from the corpus. If the target movie
   itself lacks corpus metadata: fetch its TMDb details+credits **now**
   (TMDb is fine on demand; use `cachedTmdbFetch` keyed
   `projection_target:{tmdb_id}` so 20 draft cards don't refetch), upsert
   the corpus stub with `priority = 100`, and insert stubs for any unknown
   predecessors (no ratings — those are queued for Stage C).
3. Compute, upsert `movie_projections`, return. `partial` rows get a 1 h
   effective TTL so they refresh as ingestion fills gaps.
4. Movies with `release_date` in the past and a real `combined_score` return
   `null` — never project what is already scored.

If `projections_display` is off, the function still computes and caches (so
turning the flag on is instant) but the frontend hook does not call it.

Freeze: `update-scores` sets `frozen_at = now(), actual_rt = <score>` on the
`movie_projections` row the first time it writes a Tomatometer for that
tmdb_id. One extra update in the existing per-movie loop.

### 8.1 Pre-release score polling (change to `update-scores`)

Add a third selection branch: movies with `status = 'upcoming'`,
`release_date` within the next 30 days, and `scores_updated_at` older than
24 h, capped at 60/run and reserved through `reserve_external_api_calls`
under `mdblist:projections` (it shares the projections slice; the nightly
branch stays unreserved and first by schedule). A Tomatometer found here is
written exactly as a post-release score is; the movie's status is unchanged.
This surfaces festival and embargo-lift scores while players are still
trading and bidding — the strongest "projection" there is.

---

## 9. Backtest gate before display

Before `projections_display` is ever set to `true`:

1. Ingestion has run to `remaining_ratings < 200`.
2. `deno run scripts/backtest-projections.ts` (reads the corpus with the
   service key, runs §7 steps 1–3, prints the metrics table and writes
   `docs/projections/backtest-<date>.md`).
3. Ship criterion: **Spearman ρ ≥ 0.40 on held-out years** and calibration
   within ±10 points in every decile for `p_rotten`. If it fails, the
   feature stays dark; the corpus and pipeline still pay for themselves
   through pre-release polling and the analytics surfaces in §12.

Expected result from the literature and comparable public datasets: MAE
12–16, ρ 0.45–0.55, with franchise and director carrying most of the signal.
These are expectations, not promises; the gate decides.

---

## 10. Frontend

Design-system work follows the `frontend-design` skill; Cinematic Dark
tokens throughout. No new colours: projections are *guidance*, so the chip
is gold-outline, never success/crimson (those mean *real* points).

### 10.1 Components (`apps/frontend/app/components/projections/`)

- **`BetaBadge`** — `rounded-full px-1.5 text-[10px] font-semibold uppercase
  tracking-[0.08em] bg-gold/15 text-gold border border-gold/30`, text
  "Beta", `title="Projections are estimates and may be wrong"` plus an
  `sr-only` sentence. The first Beta chip in the app; built generic so other
  betas can reuse it.
- **`ProjectionChip`** — `Proj. 72%` + `BetaBadge`, muted when
  `partial`; renders nothing when the flag is off, the movie is scored, or
  the projection is `null`. Sizes `sm` (poster overlay) and `md` (rows).
- **`ProjectionBreakdown`** — the panel: headline `Projected 72% · ~14 pts
  expected`, a three-segment bar for `p_rotten / p_fresh / p_club90` with
  labels ("22% rotten · 63% fresh · 15% 90 Club"), then the factor list from
  `factors` (label · mean · n, with the `last` film where present), a
  "Still gathering: writer history" line when `partial`, and the footer
  *"Beta — estimated from past films by the same people, franchise, and
  studio. Not a guarantee."*

### 10.2 Data

- `hooks/useMovieProjections(tmdbIds: number[])` — SWR over
  `get-movie-projections`, key sorted and chunked at 50; `dedupingInterval`
  10 min; disabled (null key) while `useFeatureFlag('projections_display')`
  is not `enabled`. `useMovieProjection(tmdbId)` is the single-id wrapper.
- Surfaces that already hold `Movie`/`TeamHolding` rows select
  `movie_projections` directly by `tmdb_id` alongside their existing queries
  (cheap, RLS-permitted) and fall back to the hook only for misses.

### 10.3 Surfaces (v1)

| Surface | File | Change |
|---|---|---|
| Draft grid | `DraftMovieCard.tsx` | `ProjectionChip sm` in the poster-overlay badge row (`:74-93`) |
| Draft preview | `MovieQuickPreview.tsx` | `ProjectionBreakdown` under the meta row |
| Discover/league modals | `MovieDetailBody.tsx` consumers (`LeagueMovieModal`, `MovieDetailModal`) | `ProjectionBreakdown` in the `actions` slot when unscored |
| Bidding search + selected card | `PlaceBidModal.tsx` `:571-593`, `:622-645` | `ProjectionChip md` next to the TMDb rating |
| Dashboard hero | `MovieGrid.tsx` `NextUpHero` `:169-171` | replace the hardcoded "Not rated yet" line with chip + expected points |
| Trade proposal rows | `ProposeTradeModal.tsx` `:637-648` | `Pending` → `ProjectionChip md` when a projection exists |
| Roster / standings | `RosterClient.tsx` `:351`, `MovieScoreCard.tsx` | `Pending`/`Upcoming` label gains the chip |

Deliberately **not** in v1: `TradeOfferCard` item rows (needs the
`combined_score: null` reconstruction at `:745` fixed first), wishlist
(no score model on that page), bid cards (`movie_data` has no tmdb-level
join yet). Listed in §12.

### 10.4 Beta labelling rules

- Every rendered projection carries `BetaBadge`; the chip and the panel
  cannot be rendered without it (the badge is inside the components, not a
  prop).
- The breakdown footer disclaimer is static copy in one place
  (`projections/copy.ts`) so wording changes once.
- The league settings page gets no toggle in v1; the global flag is the
  only switch and it is documented in `feature_flags.description`.

---

## 11. Testing

**Deno unit (`_shared/*.test.ts`, no DB):**
- `scoring-curve.test.ts` — the seven tier examples; monotonicity.
- `projection-model.test.ts` — shrinkage with n=0/1/10; recency weights;
  leak-proofing (a prior film dated after the target is ignored);
  distribution sums to 1; `expected_points` ≠ `rtToFantasyPoints(μ)` near
  the 90 kink; coverage arithmetic; `factors` JSON shape and `missing`.
- `ridge.test.ts` — recovers known coefficients from synthetic data.
- `mdblist-budget.test.ts` — grant math against a mocked RPC; 0 when cap hit.
- `ingest-film-corpus.test.ts` — via `createMockDbClient` + `stubFetch`:
  flag off → no fetches; stage ordering; 429 aborts Stage C and finishes
  `partial`; `ratings_absent` stamped on 404; priority order respected.
- `fit-projection-model.test.ts` — gate: bad metrics → inactive row, old
  model stays active.
- `feature-flags.test.ts` — missing row reads disabled; memo TTL.

**Integration (`tests/`, local Supabase):**
- `get-movie-projections.test.ts` — seeded corpus → deterministic
  projection; scored movie → `null`; unknown target enqueues stubs; batch of
  50 ok, 51 rejected.
- `reserve_external_api_calls` presence + service-role-only grant (its cap/concurrency semantics are covered by PR #72's `tests/reserve-external-api-calls.test.ts`).

**Playwright:** with `projections_display` on, the draft grid shows a
`[data-testid="projection-chip"]` containing "Beta"; with it off, none
render. (Flag flipped through the service client in the test setup.)

**Backtest script** is the model's real test; its output is committed under
`docs/projections/`.

---

## 12. Rollout and follow-ups

**Phase 1 — plumbing (dark):** migration, `feature_flags` + helpers,
budget guard, `ingest-film-corpus`, cron wiring, ops metadata. Ships with
`projections_ingestion` off: turn it on in Studio after a supervised first
run, then let the backfill run its 20+ days. Pre-release polling ships here
too — it is useful on its own.

**Phase 2 — model:** curve mirror, factors, ridge, `fit-projection-model`,
`get-movie-projections`, backtest script. Run the gate (§9); commit the
report.

**Phase 3 — UI (Beta):** components, hook, seven surfaces, Playwright.
Flip `projections_display` in Studio once the gate passes.

Follow-ups, in rough order of value: Discord bot `movie`, `roster`,
`top-available` parity (bot reads `movie_projections` directly, service
role); `TradeOfferCard` rows; analytics surfaces that need no model
(director/actor track-record cards, franchise trajectory, projected-vs-actual
league page); the trade breakdown feature using `expected_points`; a
per-league settings toggle if commissioners ask; promotion of crowd signals
to model features once volume exists; PostHog or Edge Config if flags
multiply.

---

## 13. Open decisions (defaults chosen; override in review)

1. **Vote-count floor for the historical seed** — `300` keeps the corpus to
   wide, reviewed releases (~2.5–3k). Lowering to `100` roughly doubles it
   and the backfill time.
2. **Daily MDBList budget** — `500` for projections, beside PR #72's 300
   for franchise history and ~120 for scoring (920 worst case). Adjustable
   in Studio without a deploy.
3. **Ship gate** — ρ ≥ 0.40 / MAE ≤ 16. A stricter gate delays the feature;
   a looser one risks the "confidently wrong" outcome the Beta label is
   meant to soften, not excuse.
4. **Modal placement** — breakdown in `MovieDetailBody`'s `actions` slot
   (above genres/synopsis) rather than below cast, so it is visible on a
   phone without scrolling.
