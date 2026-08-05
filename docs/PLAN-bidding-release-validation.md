# Plan: Block bids on released movies + make counterpicks source-agnostic

## Context

Two confirmed defects in the bidding/counterpick system, verified against the local
database on 2026-08-05 at commit `3b11bbe`.

**Defect 1 — bids are accepted on already-released movies.**

- `get_counterpick_options` (defined in `supabase/migrations/20260203_counterpick_system.sql:236`)
  has no release-date predicate. In the seeded "Oscar Contenders" league it returns 10 options,
  every one already released with final `fantasy_points` visible. `CounterpickPicker.tsx`
  renders those points as a badge, so the UI shows the answer before the user picks.
- `place-counterpick-bid` and `make-counterpick` never read `release_date`.
- `process-bids` awards a counterpick with `fantasy_points: -movie.fantasy_points`, so bidding
  on an already-flopped movie banks a guaranteed positive score with zero risk.
- `place-bid` calls `is_movie_eligible_for_pickup(league_id, tmdb_id, p_movie_id: null)`. Inside
  that function the entire release-date branch is wrapped in `IF p_movie_id IS NOT NULL`, so
  passing NULL skips it. Verified: Spider-Man 4 (released 2026-07-24, scored 93) returns
  eligible when called the way `place-bid` calls it, and ineligible when passed a movie_id.
- Even with a movie_id the function only rejects a released movie when
  `combined_score IS NOT NULL`. A movie released three days ago that MDBList has not scored yet
  still passes. Verified: Test Movie Beta (released 2026-07-20, unscored) returns eligible
  both ways.
- Nothing revalidates at processing time. `get_next_processing_deadline` is next Saturday
  8pm UTC, so bids sit pending up to seven days; a bid placed legitimately on Sunday for a
  Friday release is awarded on Saturday, after the movie is out.

**Defect 2 — pickups cannot be counterpicked.**

- `get_counterpick_options` selects `FROM draft_picks` only; there is no pickups leg.
- `counterpicks.draft_pick_id` and `counterpick_bids.draft_pick_id` are both `NOT NULL`
  foreign keys to `draft_picks`, so a counterpick is structurally incapable of pointing at a
  pickup.
- Nothing writes pickups into `draft_picks`; `process-bids/index.ts:463` inserts into `pickups`.
- Verified: in Oscar Contenders, Golden Globe Gang owns Minions 3 and Fast X Part 2 via pickup.
  Zero pickup rows are offered as counterpick options; 10 drafted movies are.

## Global Constraints

These bind every task. A reviewer should treat a violation as a defect.

1. **The release rule is exactly one predicate, applied identically everywhere:**
   a movie is biddable and counterpickable only if
   `release_date IS NOT NULL AND release_date >= CURRENT_DATE` (UTC).
   Release, not scoring. Do not gate on `combined_score`, `fantasy_points`, or `status`.
   Scores lag release by days, and gating on score is precisely the bug being fixed.
2. **In TypeScript, use the existing `isUpcomingMovie()` helper** from
   `supabase/functions/_shared/utils.ts`. Do not write a second inline date comparison.
   Note it is stricter than the SQL rule (it also rejects a null release date and a
   previous-year release); that is intended and acceptable.
3. **Dual-source records mirror the existing `team_drops` pattern**: nullable `pickup_id`,
   nullable `draft_pick_id`, and a CHECK constraint enforcing exactly one is set. Do not
   invent a different representation (no polymorphic `source_type`/`source_id` pair).
4. **Do not change the Edge Function request contracts.** `place-counterpick-bid` and
   `make-counterpick` both take `{ league_id, movie_id }` and must keep taking exactly that.
   The frontend must not need to learn about pickup vs draft ids to place a counterpick.
5. **Migrations are additive and non-destructive.** New timestamped migration files only;
   never edit an existing migration. Use `CREATE OR REPLACE FUNCTION` for RPC changes.
   The migration must apply cleanly via `npx supabase migration up` on a database with
   existing data.
6. **Follow the project's RLS and Postgres conventions** from CLAUDE.md: wrap `auth.*` calls
   in subqueries, add `TO authenticated` on user-facing policies, and keep `SECURITY DEFINER`
   where the existing function already used it.
7. **Every task must leave `npm run test:functions` passing.**

---

## Task 1: Migration — source-agnostic counterpicks and release filtering

Create ONE new migration file, `supabase/migrations/<timestamp>_counterpick_pickups_and_release_filter.sql`
(generate the timestamp with `npx supabase migration new counterpick_pickups_and_release_filter`,
which creates the correctly-named empty file for you to fill in).

It must do all of the following.

**1a. Make counterpick tables source-agnostic.**

On both `counterpicks` and `counterpick_bids`:
- `ALTER COLUMN draft_pick_id DROP NOT NULL`
- Add `pickup_id UUID REFERENCES pickups(id) ON DELETE CASCADE` (nullable)
- Add a CHECK constraint named `counterpicks_exactly_one_source` /
  `counterpick_bids_exactly_one_source` enforcing exactly one of
  (`draft_pick_id`, `pickup_id`) is non-null. Copy the shape of the existing
  `team_drops_exactly_one_source` constraint.
- Add an index on the new `pickup_id` column on both tables.

No backfill is needed: every existing row already has a `draft_pick_id`.

**1b. Add the counterpicked flag to pickups.**

`ALTER TABLE pickups ADD COLUMN counterpicked_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL`,
mirroring the identical column on `draft_picks`. Add the matching partial index and a
`COMMENT ON COLUMN` in the same style as the `draft_picks` one in
`20260203_counterpick_system.sql`.

**1c. Rewrite `get_counterpick_options`.**

`CREATE OR REPLACE FUNCTION get_counterpick_options(p_league_id UUID, p_team_id UUID)`.

The returned table gains two columns; keep every existing column and its name, and append:
- `source TEXT` — `'draft'` or `'pickup'`
- `pickup_id UUID` — null for draft rows

`draft_pick_id` stays in the result but becomes nullable (null for pickup rows).

The body becomes a UNION ALL over `draft_picks` and `pickups`, with these predicates applied
to BOTH legs:
- row not dropped (`dropped_at IS NULL`)
- not the requesting team's own movie (`team_id != p_team_id`)
- movie not already counterpicked in this league
  (`NOT EXISTS (SELECT 1 FROM counterpicks c WHERE c.league_id = p_league_id AND c.movie_id = ...)`)
- **the movie is not yet released** — `m.release_date IS NOT NULL AND m.release_date >= CURRENT_DATE`

Keep the existing `ORDER BY m.release_date ASC NULLS LAST, m.title ASC` and keep
`SECURITY DEFINER`. Update the `COMMENT ON FUNCTION` to describe both sources and the
release filter.

**1d. Fix `is_movie_eligible_for_pickup`.**

`CREATE OR REPLACE FUNCTION is_movie_eligible_for_pickup(p_league_id UUID, p_tmdb_id INTEGER, p_movie_id UUID DEFAULT NULL)`.

Two bugs to fix, keeping the existing signature and the existing ownership logic intact:
- The release check must run regardless of which identifier the caller passed. When
  `p_movie_id` is NULL, look the movie up by `p_tmdb_id` instead. If no movie row exists at
  all for that tmdb_id, that is not a rejection — an unknown movie is not yet in the database
  and remains eligible (this is the normal path for a movie being bid on for the first time).
- The rejection condition changes from "released AND has a score" to "released", per Global
  Constraint 1.

Leave the existing dropped-aware ownership check (`draft_picks` UNION `pickups`, both
filtered on `dropped_at IS NULL`) exactly as it is.

**Verification for this task:** apply with `npx supabase migration up` against the running
local database and confirm with psql that (a) `get_counterpick_options` for
league `22222222-bbbb-bbbb-bbbb-222222222222`, team `e2222222-0001-0001-0001-000000000001`
now returns zero rows (all seeded roster movies are released — this is correct, not a
regression), and (b) `is_movie_eligible_for_pickup('22222222-bbbb-bbbb-bbbb-222222222222', 634649, NULL)`
now returns false where it previously returned true. Include the psql output in your report.

---

## Task 2: Edge Functions — accept pickups and reject released movies

Depends on Task 1 (uses the new columns and the new `get_counterpick_options` shape).

**2a. `supabase/functions/place-counterpick-bid/index.ts`**

The `draft_picks` lookup by `movie_id` currently 404s with "Movie not found in this league
draft" — that single query is what rejects every pickup today. Replace it with a lookup that
finds the movie in `draft_picks` OR `pickups` within the league, both filtered on
`dropped_at IS NULL`. Keep the existing checks (not your own movie, not already
counterpicked, the belt-and-suspenders `counterpicks` check) working against whichever
source matched.

Add the release-date guard: fetch the movie's `release_date` and reject with a 400 and a
clear message before any insert. Use `isUpcomingMovie()`.

On insert into `counterpick_bids`, set `draft_pick_id` or `pickup_id` according to the source
and leave the other null.

Note: the function already fetches movie info (title/poster/release_date) further down for
notifications; consider hoisting that single fetch rather than adding a second query.

**2b. `supabase/functions/make-counterpick/index.ts`**

Same two changes for the live counterpick round: dual-source lookup, and a release-date
guard placed before the `counterpicks` insert. This function already fetches the movie row
(currently below the validation block) — move it up and reuse it rather than adding a query.
Set the correct id column on the `counterpicks` insert, and update the
`counterpicked_by_team_id` flag on whichever table the source row lives in.

**2c. `supabase/functions/place-bid/index.ts`**

- Pass the real movie id to `is_movie_eligible_for_pickup` when the movie exists in `movies`
  (look it up by `tmdb_id`); keep passing null only when it genuinely does not exist yet.
- Add an `isUpcomingMovie()` check on the release date before the eligibility RPC call.
  Prefer the `movies` row's `release_date` when the movie exists; fall back to
  `movie_data.release_date` when it does not. Reject with 400 and a clear message.
- Leave a short comment noting that `movie_data` is client-supplied and therefore only
  trusted when no database row exists — the authoritative recheck happens in `process-bids`.

**Verification:** `npm run test:functions` passes.

---

## Task 3: Revalidate at processing time

Depends on Tasks 1 and 2.

`supabase/functions/process-bids/index.ts`.

**3a. Pickup path.** After the movie row is resolved or created and before the `pickups`
insert, recheck the release date against the authoritative `movies` row. If the movie has
released since the bid was placed: do not create the pickup, do not call `deductTeamBudget`,
mark the winning bid `cancelled` (the `bid_status` enum already has `active, outbid, won,
lost, cancelled` — no enum migration needed), and record the skip in the results payload so
it appears in the function's response.

**3b. Counterpick path.** Same treatment before the `counterpicks` insert: recheck
`movies.release_date`, and on failure mark the bid `cancelled`, skip the budget deduction,
and skip both the counterpick insert and the `counterpicked_by_team_id` update.

**3c.** The counterpick insert must set `draft_pick_id` or `pickup_id` based on which column
the winning `counterpick_bids` row carries, and the flag update must target the matching
table (`draft_picks` or `pickups`).

**3d.** Notify the bidder when their bid is voided this way. Follow the existing notification
pattern in this file — a `notifications` row is the minimum; match how the surrounding code
builds them. A user whose bid silently vanishes will file a support request.

**Verification:** `npm run test:functions` passes, including
`supabase/functions/tests/process-bids.test.ts`.

---

## Task 4: Frontend — types and picker copy

Depends on Tasks 1-3. Small task, mostly type plumbing.

- `apps/frontend/types/index.ts`: add `source: 'draft' | 'pickup'` and `pickup_id: string | null`
  to the `CounterpickOption` type, and make `draft_pick_id` nullable there. Add
  `counterpicked_by_team_id` to the pickup type if one exists.
- `CounterpickPicker.tsx` keys its cards on `option.draft_pick_id`, which is now null for
  pickups — switch the React key and the selection-identity comparison to `option.movie_id`,
  which is unique per league across both sources.
- Update the empty-state copy. It currently reads "All opponent movies have already been
  counterpicked", which is now frequently the wrong reason — unreleased-only filtering means
  the list is also empty when every opponent movie has already released. Write copy that
  covers both without being vague.
- Add a submit-time guard in `PlaceBidModal.tsx` so a stale movie list cannot post an
  already-released title.

Consult the `frontend-design` skill before touching component markup, per CLAUDE.md, and keep
to the Cinematic Dark tokens and component classes.

**Verification:** `npm run build` succeeds from the repo root.

---

## Task 5: Tests

Depends on Tasks 1-4.

Add Deno tests covering the new behavior. Follow the existing conventions in
`supabase/functions/tests/` — the mock utilities in `_test_utils/mocks.ts`, the fixtures in
`_test_utils/fixtures.ts`, and valid UUID formats (8-4-4-4-12 hex).

- `tests/place-bid.test.ts` — extend: a bid on an already-released movie is rejected with 400.
- `tests/place-counterpick-bid.test.ts` — extend the file that already exists: a counterpick
  bid on a released movie is rejected; a counterpick bid on an opponent's *pickup* succeeds
  and writes `pickup_id` with `draft_pick_id` null.
- `tests/make-counterpick.test.ts` — extend: released movie rejected; pickup counterpick
  succeeds.
- `tests/process-bids.test.ts` — extend with the important regression: a bid that was valid at
  placement time but whose movie released before the processing deadline is marked
  `cancelled`, creates no pickup/counterpick, and leaves the team budget untouched.

**Verification:** `npm run test:functions` passes with the new tests included, and the count
of passing tests is higher than before. Report the before and after numbers.

---

## Task 6: Seed data

Depends on Task 1.

Every roster movie in the seeded leagues is already released, so after Task 1 the counterpick
picker correctly shows nothing locally and the flow cannot be exercised in a browser.

Update `supabase/seed.sql` so at least one league has opponent roster movies with 2026 release
dates in the future (relative to a working date of 2026-08-05), covering both a drafted movie
and a pickup, so the counterpick picker has options from both sources. Keep the existing
seeded users, leagues, and ids stable — other tests and the CLAUDE.md verification flow depend
on them.

**Verification:** `npx supabase db reset` completes, and
`get_counterpick_options` returns at least one draft-sourced and one pickup-sourced row for
some team. Include the psql output in your report.
