# Pickup Bid Priority and Conditional Drops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team keep bidding once its roster is full, by ranking its own pending pickup bids and optionally attaching a drop that fires only if the bid wins.

**Architecture:** Generalize the existing, unit-tested counterpick resolver (`_shared/counterpick-resolution.ts`) from a single integer capacity into a multi-dimensional `TeamCapacity`, rename it `_shared/bid-resolution.ts`, and route both pickup and counterpick contests through it. `process-bids` stops resolving pickup movies one at a time and instead collects, resolves, and awards as a batch — which is how the counterpick path in the same file already works.

**Tech Stack:** Deno (Supabase Edge Functions), PostgreSQL + RLS, Next.js 15 / React 19, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-20-pickup-bid-priority-conditional-drops-design.md`

## Global Constraints

- **No "FAAB" in user-facing text.** "Fantasy Budget", or "Budget" where space is tight. Applies to UI copy, Discord embeds, emails, and DB function messages. Schema identifiers (`leagues.faab_budget`, `trade_assets.faab_amount`) keep the old name.
- **New Edge Functions need a `config.toml` entry with `verify_jwt = false`** before deploy, or they return `{"code":401,"message":"Invalid JWT"}` in production. Functions authenticate internally.
- **No ad-hoc `console.*` in Edge Functions.** Use `createLogger('<fn-name>')` and `serializeError(err)`. End every outer catch with `return internalErrorResponse(error, log)`.
- **Frontend must call Edge Functions through `callEdgeFunction`** (`utils/supabase/functions.ts`), never raw `fetch`.
- **All roster reads go through the `team_holdings` view**, never `draft_picks`/`pickups` directly. Writes still target the base tables.
- **Migrations are applied with `npx supabase migration up`**, never `db reset` — a reset destroys all local data.
- **Design system:** semantic tokens (`bg-surface`, not `bg-[#1c1c1c]`), component classes (`.card`, `.btn-primary`, `.alert-warning`), `font-display` on headings.
- **PostgREST ambiguous FKs:** `pickups` and `draft_picks` each have two FKs to `teams`, so embeds must name the constraint, e.g. `teams!pickups_team_id_fkey(...)`.

**Known-failing test, not caused by this branch:** `supabase/functions/tests/process-bids-dropped-targets.test.ts` fails on `main`. Do not chase it.

**Integration tests do not see your worktree by default.** `npx supabase start`'s edge runtime serves the **main checkout's** functions, so an integration test run from this worktree exercises unmodified code and passes for the wrong reason. Each affected suite reads a URL from the environment; serve the worktree copy standalone and point the suite at it:

```bash
# terminal 1 — from the worktree, binds :8000
cd supabase/functions && deno run --allow-all --env-file=../../.env.test place-bid/index.ts

# terminal 2
PLACE_BID_URL=http://127.0.0.1:8000 deno test --allow-all tests/place-bid.test.ts
```

The env var differs per suite: `PLACE_BID_URL` (place-bid), `PROCESS_BIDS_URL` (process-bids), `PRIORITIES_URL` (set-counterpick-bid-priorities; use the same name for the new pickup suite). This worktree also needs `.env.test` copied from the main checkout — it is gitignored.

Pure unit tests (`_shared/bid-resolution.test.ts`) have no such problem: they import the module directly.

---

### Task 1: Migration — priority and conditional-drop columns

**Files:**
- Create: `supabase/migrations/20260820120000_pickup_bid_priority_and_conditional_drops.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `pickup_bids.priority INTEGER NOT NULL DEFAULT 1`, `pickup_bids.conditional_drop_draft_pick_id UUID NULL`, `pickup_bids.conditional_drop_pickup_id UUID NULL`, index `idx_pickup_bids_team_priority`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260820120000_pickup_bid_priority_and_conditional_drops.sql`:

```sql
-- Pickup bid priority and conditional drops
--
-- A team may now bid past a full roster. Two mechanisms make that safe, both
-- mirroring what counterpick_bids already does (20260805150000):
--
-- `priority` is the team's own ranking among its pending bids -- 1 is the one
-- it wants most. It never decides who WINS a contest; the highest bid does
-- that. It decides which of a team's own winning bids it keeps when it wins
-- more than it has room for. Priorities are NOT unique: gaps and duplicates
-- are tolerated and normalized at processing time, which keeps cancels and
-- reorders from needing a transaction just to avoid transient collisions.
--
-- The conditional drop columns name a holding released only if this bid wins.
-- Two nullable FKs rather than (source, id) because a holding lives in one of
-- two tables and both deserve real referential integrity -- the same shape
-- team_drops and counterpick_bids use. ON DELETE SET NULL degrades a bid whose
-- target row was deleted into a bid with no conditional drop, which is exactly
-- the fallback process-bids applies when a target has merely become
-- undroppable.

ALTER TABLE pickup_bids
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conditional_drop_draft_pick_id UUID
    REFERENCES draft_picks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conditional_drop_pickup_id UUID
    REFERENCES pickups(id) ON DELETE SET NULL;

ALTER TABLE pickup_bids
  DROP CONSTRAINT IF EXISTS check_at_most_one_conditional_drop;

ALTER TABLE pickup_bids
  ADD CONSTRAINT check_at_most_one_conditional_drop CHECK (
    conditional_drop_draft_pick_id IS NULL
    OR conditional_drop_pickup_id IS NULL
  );

COMMENT ON COLUMN pickup_bids.priority IS
  'Team-chosen rank among its own pending pickup bids (1 = wanted most). Ties/gaps are normalized during bid processing.';
COMMENT ON COLUMN pickup_bids.conditional_drop_draft_pick_id IS
  'Draft pick released only if this bid wins. Mutually exclusive with conditional_drop_pickup_id.';
COMMENT ON COLUMN pickup_bids.conditional_drop_pickup_id IS
  'Pickup released only if this bid wins. Mutually exclusive with conditional_drop_draft_pick_id.';

-- Backfill from the ordering process-bids applied implicitly (highest amount,
-- then earliest placed), so no bid pending at deploy time changes outcome.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY league_id, team_id
      ORDER BY amount DESC, created_at ASC
    ) AS new_priority
  FROM pickup_bids
  WHERE status IN ('active', 'outbid')
)
UPDATE pickup_bids AS pb
SET priority = ranked.new_priority
FROM ranked
WHERE pb.id = ranked.id;

-- Supports "fetch this team's pending bids in priority order", which both the
-- reorder endpoint and the bidding page do on every load.
CREATE INDEX IF NOT EXISTS idx_pickup_bids_team_priority
  ON pickup_bids (league_id, team_id, priority)
  WHERE status IN ('active', 'outbid');
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: applies cleanly, no error. If local Supabase is not running, `npx supabase start` first.

- [ ] **Step 3: Verify the schema landed**

Run:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d pickup_bids"
```
Expected: `priority | integer | not null default 1`, both `conditional_drop_*` columns present, `check_at_most_one_conditional_drop` listed, and `idx_pickup_bids_team_priority` under Indexes.

- [ ] **Step 4: Verify the CHECK rejects two drop targets**

Run:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "INSERT INTO pickup_bids (league_id, team_id, tmdb_id, amount, processing_deadline, conditional_drop_draft_pick_id, conditional_drop_pickup_id) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 1, now(), gen_random_uuid(), gen_random_uuid());"
```
Expected: FAILS. Either the CHECK constraint or a foreign-key violation fires — both prove the row is rejected. A successful insert means the constraint is missing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820120000_pickup_bid_priority_and_conditional_drops.sql
git commit -m "Add pickup bid priority and conditional drop columns"
```

---

### Task 2: Generalize the resolver into `_shared/bid-resolution.ts`

The heart of the change. `resolveCounterpickWinners` currently takes `ReadonlyMap<string, number>` — remaining slots. Widen that to a `TeamCapacity` record and replace the `remainingSlots.get(team) > 0` test with `canAfford`/`consume`. The per-pass loop ("each team advances only its highest-priority contender, then capacity is re-checked") is Fantasy Critic's ActionProcessor and must not change.

**Files:**
- Rename: `supabase/functions/_shared/counterpick-resolution.ts` → `supabase/functions/_shared/bid-resolution.ts`
- Rename: `supabase/functions/_shared/counterpick-resolution.test.ts` → `supabase/functions/_shared/bid-resolution.test.ts`
- Modify: `supabase/functions/process-bids/index.ts` (import path and call sites only, in this task)

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export interface TeamCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  droppableHoldingIds: ReadonlySet<string>
}
export interface ResolvableBid {
  id: string
  team_id: string
  amount: number
  priority: number
  created_at: string
  conditionalDropHoldingId: string | null
}
export interface BidContest { key: string; activeBids: ResolvableBid[] }
export type BidLossReason = 'outbid' | 'no_slots' | 'insufficient_budget'
export interface BidResolution {
  winners: Map<string, ResolvableBid>
  lossReasons: Map<string, BidLossReason>
  /** Winning bid id -> holding id it must drop. Only bids whose drop was honoured. */
  executedDrops: Map<string, string>
}
export function resolveBidWinners(
  contests: BidContest[],
  capacityByTeam: ReadonlyMap<string, TeamCapacity>,
): BidResolution
export function slotsOnlyCapacity(freeSlots: number): TeamCapacity
export function compareBidStrength(a: ResolvableBid, b: ResolvableBid): number
export function normalizeBidPriorities(contests: BidContest[]): Map<string, number>
```
`resolveTargetRevalidation`, `RetargetableCounterpickBid`, `CounterpickTargetRow`, and `TargetVoidReason` move to the renamed file unchanged — they are counterpick-specific but co-located, and splitting them is churn this task does not need.

- [ ] **Step 1: Rename both files, keeping content identical**

```bash
git mv supabase/functions/_shared/counterpick-resolution.ts supabase/functions/_shared/bid-resolution.ts
git mv supabase/functions/_shared/counterpick-resolution.test.ts supabase/functions/_shared/bid-resolution.test.ts
```

Then update the import path in the test file's import block from `'./counterpick-resolution.ts'` to `'./bid-resolution.ts'`, and in `supabase/functions/process-bids/index.ts` change `from '../_shared/counterpick-resolution.ts'` to `from '../_shared/bid-resolution.ts'`.

- [ ] **Step 2: Confirm the rename broke nothing**

Run: `cd supabase/functions && deno test _shared/bid-resolution.test.ts`
Expected: PASS, all 24 tests. A rename must not change behaviour.

- [ ] **Step 3: Commit the rename on its own**

Keeping the rename in its own commit makes the behavioural diff in the next steps readable.

```bash
git add -A supabase/functions
git commit -m "Rename counterpick-resolution to bid-resolution ahead of generalizing it"
```

- [ ] **Step 4: Write the failing tests for capacity-aware resolution**

Append to `supabase/functions/_shared/bid-resolution.test.ts`. Note the local `cap` helper — it builds a full `TeamCapacity` so each test states only the dimension it is exercising.

```ts
function cap(partial: Partial<TeamCapacity> = {}): TeamCapacity {
  return {
    freeSlots: partial.freeSlots ?? 99,
    remainingBudget: partial.remainingBudget ?? Number.MAX_SAFE_INTEGER,
    remainingDrops: partial.remainingDrops ?? 0,
    droppableHoldingIds: partial.droppableHoldingIds ?? new Set<string>(),
  }
}

/** A bid carrying a conditional drop on `holdingId`. */
function dropBid(
  id: string,
  teamId: string,
  amount: number,
  priority: number,
  holdingId: string,
): ResolvableBid {
  return { ...bid(id, teamId, amount, priority), conditionalDropHoldingId: holdingId }
}

Deno.test('budget exhaustion awards in priority order and falls through', () => {
  // Team A leads all three at $40 with $100 to spend: two fit, the third does not.
  const contests = [
    contest('X', bid('a-x', 'A', 40, 1)),
    contest('Y', bid('a-y', 'A', 40, 2)),
    contest('Z', bid('a-z', 'A', 40, 3), bid('b-z', 'B', 5, 1)),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({ remainingBudget: 100 })], ['B', cap()]]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.winners.get('Y')?.id, 'a-y')
  // A cannot afford Z, so it falls through to the runner-up rather than going unawarded.
  assertEquals(resolution.winners.get('Z')?.id, 'b-z')
  assertEquals(resolution.lossReasons.get('a-z'), 'insufficient_budget')
})

Deno.test('a conditional drop wins a contest with no free slot', () => {
  const contests = [contest('X', dropBid('a-x', 'A', 5, 1, 'h1'))]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({ freeSlots: 0, remainingDrops: 1, droppableHoldingIds: new Set(['h1']) })]]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.executedDrops.get('a-x'), 'h1')
})

Deno.test('two bids naming the same drop target: only the higher priority takes it', () => {
  const contests = [
    contest('X', dropBid('a-x', 'A', 5, 1, 'h1')),
    contest('Y', dropBid('a-y', 'A', 5, 2, 'h1'), bid('b-y', 'B', 1, 1)),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([
      ['A', cap({ freeSlots: 0, remainingDrops: 2, droppableHoldingIds: new Set(['h1']) })],
      ['B', cap()],
    ]),
  )

  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.executedDrops.get('a-x'), 'h1')
  // h1 is spent, and A has no free slot, so Y falls to B.
  assertEquals(resolution.winners.get('Y')?.id, 'b-y')
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
})

Deno.test('conditional drops are capped by remaining drop allowance', () => {
  const contests = [
    contest('X', dropBid('a-x', 'A', 5, 1, 'h1')),
    contest('Y', dropBid('a-y', 'A', 5, 2, 'h2')),
  ]

  const resolution = resolveBidWinners(
    contests,
    new Map([['A', cap({
      freeSlots: 0,
      remainingDrops: 1,
      droppableHoldingIds: new Set(['h1', 'h2']),
    })]]),
  )

  assertEquals(resolution.winners.size, 1)
  assertEquals(resolution.winners.get('X')?.id, 'a-x')
  assertEquals(resolution.lossReasons.get('a-y'), 'no_slots')
})

Deno.test('an invalid drop target degrades the bid to a plain bid', () => {
  // 'h-gone' is absent from droppableHoldingIds: the target became undroppable.
  const contests = [contest('X', dropBid('a-x', 'A', 5, 1, 'h-gone'))]

  const withSlot = resolveBidWinners(contests, new Map([['A', cap({ freeSlots: 1 })]]))
  assertEquals(withSlot.winners.get('X')?.id, 'a-x')
  // It won on a free slot, so no drop fires.
  assertEquals(withSlot.executedDrops.has('a-x'), false)

  const withoutSlot = resolveBidWinners(contests, new Map([['A', cap({ freeSlots: 0 })]]))
  assertEquals(withoutSlot.winners.size, 0)
  assertEquals(withoutSlot.lossReasons.get('a-x'), 'no_slots')
})

Deno.test('a team absent from the capacity map wins nothing', () => {
  const contests = [contest('X', bid('a-x', 'A', 5, 1), bid('b-x', 'B', 1, 1))]

  const resolution = resolveBidWinners(contests, new Map([['B', cap()]]))

  // Fail-closed: an unreadable team is treated as having no capacity at all.
  assertEquals(resolution.winners.get('X')?.id, 'b-x')
})
```

Also update the existing tests' helpers so the 24 assertions stay untouched: change `bid()` to include `conditionalDropHoldingId: null`, and change `winnerIds` to build capacities:

```ts
function winnerIds(contests: BidContest[], slots: Record<string, number>) {
  const capacities = new Map(
    Object.entries(slots).map(([team, n]) => [team, slotsOnlyCapacity(n)]),
  )
  const resolution = resolveBidWinners(contests, capacities)
  return Object.fromEntries(
    contests.map((c) => [c.key, resolution.winners.get(c.key)?.id ?? null]),
  )
}
```

Every direct `resolveCounterpickWinners(contests, new Map([['A', 1]]))` call in the existing tests becomes `resolveBidWinners(contests, new Map([['A', slotsOnlyCapacity(1)]]))`. Update the import block to pull `resolveBidWinners`, `slotsOnlyCapacity`, `type TeamCapacity`, `type ResolvableBid`, `type BidContest`.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd supabase/functions && deno test _shared/bid-resolution.test.ts`
Expected: FAIL — `resolveBidWinners` and `slotsOnlyCapacity` are not exported yet.

- [ ] **Step 6: Implement the generalization**

In `supabase/functions/_shared/bid-resolution.ts`:

Rename the types (`ResolvableCounterpickBid` → `ResolvableBid` and add `conditionalDropHoldingId: string | null`; `CounterpickContest` → `BidContest`; `CounterpickLossReason` → `BidLossReason` and add `'insufficient_budget'`). Add:

```ts
export interface TeamCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  /**
   * Holdings still available to be conditionally dropped. A target missing from
   * this set has become undroppable (released, traded away, counterpick-blocked)
   * or was already spent by a higher-priority bid from the same team.
   */
  droppableHoldingIds: ReadonlySet<string>
}

/** Capacity where slots are the only binding dimension -- counterpicks, and tests. */
export function slotsOnlyCapacity(freeSlots: number): TeamCapacity {
  return {
    freeSlots,
    remainingBudget: Number.MAX_SAFE_INTEGER,
    remainingDrops: 0,
    droppableHoldingIds: new Set<string>(),
  }
}

/** Mutable working copy of a TeamCapacity, spent down as awards are made. */
interface WorkingCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  droppableHoldingIds: Set<string>
}

/** The conditional drop this bid can actually cash right now, or null. */
function usableDrop(bid: ResolvableBid, capacity: WorkingCapacity): string | null {
  const holdingId = bid.conditionalDropHoldingId
  if (!holdingId) return null
  if (capacity.remainingDrops <= 0) return null
  return capacity.droppableHoldingIds.has(holdingId) ? holdingId : null
}

/**
 * Whether `capacity` can absorb `bid`. Budget always binds. Room comes either
 * from a free slot or from a conditional drop that is still cashable -- a
 * drop-funded award is slot-neutral, since the movie arriving and the movie
 * leaving cancel out.
 */
function canAfford(bid: ResolvableBid, capacity: WorkingCapacity | undefined): boolean {
  if (!capacity) return false
  if (capacity.remainingBudget < bid.amount) return false
  return capacity.freeSlots > 0 || usableDrop(bid, capacity) !== null
}

/**
 * Spend `bid` against `capacity`.
 *
 * A free slot is preferred over a conditional drop: the drop is the fallback
 * that buys room when there is none, and spending it while a slot sits open
 * would burn drop allowance the team did not need to spend.
 *
 * @returns the holding dropped to fund this award, or null if a slot funded it.
 */
function consume(bid: ResolvableBid, capacity: WorkingCapacity): string | null {
  capacity.remainingBudget -= bid.amount

  if (capacity.freeSlots > 0) {
    capacity.freeSlots -= 1
    return null
  }

  // canAfford already established this is non-null when no slot is free.
  const holdingId = usableDrop(bid, capacity)!
  capacity.remainingDrops -= 1
  // Retiring the holding is what stops a team's second bid from cashing the
  // same drop target twice.
  capacity.droppableHoldingIds.delete(holdingId)
  return holdingId
}
```

Then rewrite `resolveCounterpickWinners` as `resolveBidWinners`, changing only the capacity handling:

```ts
export function resolveBidWinners(
  contests: BidContest[],
  capacityByTeam: ReadonlyMap<string, TeamCapacity>,
): BidResolution {
  const normalizedPriorities = normalizeBidPriorities(contests)
  const priorityOf = (bid: ResolvableBid) => normalizedPriorities.get(bid.id) ?? bid.priority

  // Working copies, so the caller's capacities are not mutated.
  const capacities = new Map<string, WorkingCapacity>(
    [...capacityByTeam].map(([teamId, c]) => [teamId, {
      freeSlots: c.freeSlots,
      remainingBudget: c.remainingBudget,
      remainingDrops: c.remainingDrops,
      droppableHoldingIds: new Set(c.droppableHoldingIds),
    }]),
  )

  const winners = new Map<string, ResolvableBid>()
  const executedDrops = new Map<string, string>()

  const rankedBids = new Map(
    contests.map((contest) => [contest.key, contest.activeBids.slice().sort(compareBidStrength)]),
  )
  const unresolvedKeys = new Set(contests.map((contest) => contest.key))

  const outranks = (candidate: Contender, incumbent: Contender) => {
    const priorityDiff = priorityOf(candidate.bid) - priorityOf(incumbent.bid)
    if (priorityDiff !== 0) return priorityDiff < 0
    return compareBidStrength(candidate.bid, incumbent.bid) < 0
  }

  while (unresolvedKeys.size > 0) {
    const contenderByTeam = new Map<string, Contender>()
    for (const key of unresolvedKeys) {
      const bid = rankedBids.get(key)!.find((b) => canAfford(b, capacities.get(b.team_id)))
      if (!bid) continue

      const incumbent = contenderByTeam.get(bid.team_id)
      if (!incumbent || outranks({ key, bid }, incumbent)) {
        contenderByTeam.set(bid.team_id, { key, bid })
      }
    }
    if (contenderByTeam.size === 0) break

    for (const { key, bid } of contenderByTeam.values()) {
      winners.set(key, bid)
      unresolvedKeys.delete(key)
      const dropped = consume(bid, capacities.get(bid.team_id)!)
      if (dropped) executedDrops.set(bid.id, dropped)
    }
  }

  const lossReasons = new Map<string, BidLossReason>()
  for (const contest of contests) {
    const winner = winners.get(contest.key)
    for (const bid of contest.activeBids) {
      if (winner && bid.id === winner.id) continue
      const wouldHaveWon = !winner || compareBidStrength(bid, winner) < 0
      if (!wouldHaveWon) {
        lossReasons.set(bid.id, 'outbid')
        continue
      }
      // Strength was never the problem. Say which constraint actually bound,
      // so the bidder is told something they can act on.
      const capacity = capacities.get(bid.team_id)
      lossReasons.set(
        bid.id,
        capacity && capacity.remainingBudget < bid.amount ? 'insufficient_budget' : 'no_slots',
      )
    }
  }

  return { winners, lossReasons, executedDrops }
}
```

Update the `Contender` interface's `bid` field type to `ResolvableBid`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd supabase/functions && deno test _shared/bid-resolution.test.ts`
Expected: PASS — all 24 original tests plus the 6 new ones.

- [ ] **Step 8: Fix the process-bids call sites so the function still type-checks**

In `supabase/functions/process-bids/index.ts`, update the import to pull `resolveBidWinners`, `slotsOnlyCapacity`, `type BidContest`, `type BidLossReason`. At the existing counterpick call site, wrap the slots map:

```ts
const { winners, lossReasons } = resolveBidWinners(
  contests,
  new Map([...remaining].map(([teamId, slots]) => [teamId, slotsOnlyCapacity(slots)])),
)
```

Add `conditionalDropHoldingId: null` where counterpick bids are shaped into contests — counterpicks have no conditional drops.

Run: `cd supabase/functions && deno check process-bids/index.ts`
Expected: no type errors.

- [ ] **Step 9: Run the full suite**

Run: `npm run test:functions`
Expected: PASS except the known-failing `process-bids-dropped-targets.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/bid-resolution.ts supabase/functions/_shared/bid-resolution.test.ts supabase/functions/process-bids/index.ts
git commit -m "Generalize bid resolver to multi-dimensional team capacity"
```

---

### Task 3: Conditional-drop eligibility as a pure function

Which of a team's holdings may be conditionally dropped, decided by the same rules `drop-movie` enforces. Pure, so it is testable without a database; the caller supplies the rows it read.

**Files:**
- Modify: `supabase/functions/_shared/bid-resolution.ts`
- Test: `supabase/functions/_shared/bid-resolution.test.ts`

**Interfaces:**
- Consumes: nothing from Task 2 beyond living in the same module.
- Produces:
```ts
export interface DroppableCandidate {
  holdingId: string
  releaseDate: string | null
  counterpickedByTeamId: string | null
  hasPendingCounterpickBid: boolean
}
export function droppableHoldingIds(
  candidates: DroppableCandidate[],
  options: { today: string; counterpicksBlockDrops: boolean },
): Set<string>
```
`today` is an ISO date string (`YYYY-MM-DD`), passed in rather than read from the clock so tests are deterministic.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/bid-resolution.test.ts`:

```ts
function candidate(
  holdingId: string,
  overrides: Partial<DroppableCandidate> = {},
): DroppableCandidate {
  return {
    holdingId,
    releaseDate: '2099-01-01',
    counterpickedByTeamId: null,
    hasPendingCounterpickBid: false,
    ...overrides,
  }
}

const TODAY = '2026-08-20'

Deno.test('an unreleased, uncontested holding is droppable', () => {
  const ids = droppableHoldingIds([candidate('h1')], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('a released holding is not droppable', () => {
  // drop-movie refuses release_date < today; a conditional drop must match.
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: '2026-08-19' })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals(ids.size, 0)
})

Deno.test('a holding released today is still droppable', () => {
  // The rule is strictly "before today", matching drop-movie's < comparison.
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: TODAY })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('a holding with no release date is droppable', () => {
  const ids = droppableHoldingIds([candidate('h1', { releaseDate: null })], {
    today: TODAY,
    counterpicksBlockDrops: true,
  })

  assertEquals([...ids], ['h1'])
})

Deno.test('counterpick state blocks a drop only when the league says so', () => {
  const candidates = [
    candidate('awarded', { counterpickedByTeamId: 'team-x' }),
    candidate('pending', { hasPendingCounterpickBid: true }),
  ]

  const blocked = droppableHoldingIds(candidates, {
    today: TODAY,
    counterpicksBlockDrops: true,
  })
  assertEquals(blocked.size, 0)

  const allowed = droppableHoldingIds(candidates, {
    today: TODAY,
    counterpicksBlockDrops: false,
  })
  assertEquals(allowed.size, 2)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd supabase/functions && deno test _shared/bid-resolution.test.ts`
Expected: FAIL — `droppableHoldingIds` is not exported.

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/bid-resolution.ts`:

```ts
/**
 * ---------------------------------------------------------------------------
 * Conditional drop eligibility
 * ---------------------------------------------------------------------------
 *
 * A pickup bid may name a holding released only if the bid wins. Bids sit
 * pending for up to a week (see get_next_processing_deadline), so what was
 * droppable at bid time may not be at processing time -- the movie can release,
 * or get counterpicked. These are the same rules drop-movie enforces; keeping
 * them here, pure, means the decision is testable and the two paths cannot
 * silently disagree about what "droppable" means.
 *
 * A target failing these checks does not void the bid. It degrades to a bid
 * with no conditional drop, which can still win on a free slot -- the team
 * wanted the movie, and the drop was only the means of paying for it.
 */

export interface DroppableCandidate {
  holdingId: string
  releaseDate: string | null
  counterpickedByTeamId: string | null
  hasPendingCounterpickBid: boolean
}

/**
 * @param today ISO date (YYYY-MM-DD). Passed in rather than read from the clock
 *   so callers and tests agree on the boundary.
 */
export function droppableHoldingIds(
  candidates: DroppableCandidate[],
  options: { today: string; counterpicksBlockDrops: boolean },
): Set<string> {
  const droppable = new Set<string>()

  for (const candidate of candidates) {
    // Released movies are locked: their score is already in play.
    if (candidate.releaseDate && candidate.releaseDate < options.today) continue

    if (options.counterpicksBlockDrops) {
      if (candidate.counterpickedByTeamId) continue
      // A pending counterpick auction would be stranded by the drop.
      if (candidate.hasPendingCounterpickBid) continue
    }

    droppable.add(candidate.holdingId)
  }

  return droppable
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd supabase/functions && deno test _shared/bid-resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/bid-resolution.ts supabase/functions/_shared/bid-resolution.test.ts
git commit -m "Add conditional drop eligibility rules to bid resolver"
```

---

### Task 4: Capacity assembly in `process-bids`

Replace `getRemainingCounterpickSlots` with `getTeamCapacities`, keeping its fail-closed contract: a team whose config, holdings, budget, or drop count could not be read gets zero capacity. Reading a failed count as "zero used" would hand out a full allowance on top of what the team already holds — the exact over-cap outcome this guards against.

**Files:**
- Modify: `supabase/functions/process-bids/index.ts` (replace `getRemainingCounterpickSlots`, ~line 265)

**Interfaces:**
- Consumes: `TeamCapacity`, `DroppableCandidate`, `droppableHoldingIds` from Tasks 2–3.
- Produces:
```ts
async function getTeamCapacities(
  serviceClient: ServiceClient,
  contests: BidContest[],
  kind: 'pickup' | 'counterpick',
): Promise<{ capacities: Map<string, TeamCapacity>; slotsByLeague: Map<string, number> }>
```
Contest keys are `${league_id}:${...}`, so the league is recoverable via `key.split(':')[0]` — unchanged from `getRemainingCounterpickSlots`.

`slotsByLeague` is the league's **total** slots for this kind, not the remainder. It exists solely because `process-bids/index.ts:1197` passes it into the counterpick "no slots" email copy, which quotes the league's allowance. Returning it keeps that call site byte-identical.

- [ ] **Step 1: Implement `getTeamCapacities`**

Replace `getRemainingCounterpickSlots` in `supabase/functions/process-bids/index.ts`. Reuse the existing `selectByIdBatches` helper and its `unreadIds` contract verbatim.

```ts
/**
 * How much each team in `contests` can still absorb this run.
 *
 * Fails closed on every dimension: a team whose league config, holdings,
 * budget, or drop count could not be read is given zero capacity. That
 * withholds awards for one run, which a later run can still make -- whereas
 * reading a failed count as "zero used" would hand a team a full allowance on
 * top of what it already holds, the over-cap outcome this exists to prevent.
 *
 * `freeSlots` means "room for one more movie of this kind", and the two kinds
 * measure against different pools: pooled roster room for pickups, remaining
 * bidding_counterpick_slots for counterpicks. They never collide because the
 * two are resolved in separate calls with their own capacity map.
 */
async function getTeamCapacities(
  serviceClient: ServiceClient,
  contests: BidContest[],
  kind: 'pickup' | 'counterpick',
): Promise<Map<string, TeamCapacity>> {
  const leagueOfTeam = new Map<string, string>()
  for (const contest of contests) {
    const leagueId = contest.key.split(':')[0]
    for (const bid of contest.activeBids) leagueOfTeam.set(bid.team_id, leagueId)
  }

  const leagueIds = [...new Set(leagueOfTeam.values())]
  const teamIds = [...leagueOfTeam.keys()]
  const capacities = new Map<string, TeamCapacity>()
  const slotsByLeague = new Map<string, number>()
  if (teamIds.length === 0) return { capacities, slotsByLeague }

  const { rows: leagueRows } = await selectByIdBatches<{
    id: string
    total_slots: number | null
    bidding_counterpick_slots: number | null
    drop_limit: number | null
    counterpicks_block_drops: boolean | null
  }>(
    leagueIds,
    'Failed to load league capacity config:',
    (batch) =>
      serviceClient
        .from('leagues')
        .select('id, total_slots, bidding_counterpick_slots, drop_limit, counterpicks_block_drops')
        .in('id', batch),
  )
  // A league missing here -- unread or genuinely absent -- yields zero slots below.
  const leagueById = new Map(leagueRows.map((league) => [league.id, league]))

  for (const league of leagueRows) {
    slotsByLeague.set(
      league.id,
      kind === 'counterpick' ? (league.bidding_counterpick_slots ?? 0) : (league.total_slots ?? 0),
    )
  }

  const { rows: budgetRows, unreadIds: unreadBudgetTeams } = await selectByIdBatches<
    { team_id: string; remaining_budget: number }
  >(
    teamIds,
    'Failed to load team budgets:',
    (batch) =>
      serviceClient.from('team_budgets').select('team_id, remaining_budget').in('team_id', batch),
  )
  const budgetByTeam = new Map(budgetRows.map((row) => [row.team_id, row.remaining_budget]))

  // Used-capacity counts, per kind.
  const usedByTeam = new Map<string, number>()
  let unreadUsedTeams = new Set<string>()

  if (kind === 'counterpick') {
    // Counts `counterpicks` rows, the same accounting place-counterpick-bid
    // applies, so the two cannot disagree about what "used a slot" means.
    const { rows, unreadIds } = await selectByIdBatches<{ counterpicker_team_id: string }>(
      teamIds,
      'Failed to count used counterpick slots:',
      (batch) =>
        serviceClient
          .from('counterpicks')
          .select('counterpicker_team_id')
          .eq('phase', 'bidding')
          .in('counterpicker_team_id', batch),
    )
    for (const row of rows) {
      usedByTeam.set(row.counterpicker_team_id, (usedByTeam.get(row.counterpicker_team_id) ?? 0) + 1)
    }
    unreadUsedTeams = unreadIds
  } else {
    // Pooled roster: every active holding, draft picks and pickups alike.
    // team_holdings excludes dropped rows itself, so there is no dropped_at
    // filter to forget here.
    const { rows, unreadIds } = await selectByIdBatches<{ team_id: string }>(
      teamIds,
      'Failed to count active holdings:',
      (batch) => serviceClient.from('team_holdings').select('team_id').in('team_id', batch),
    )
    for (const row of rows) {
      usedByTeam.set(row.team_id, (usedByTeam.get(row.team_id) ?? 0) + 1)
    }
    unreadUsedTeams = unreadIds
  }

  // Drops and droppable holdings are pickup-only; counterpicks carry no
  // conditional drops, which makes canAfford collapse to today's behaviour.
  const dropsByTeam = new Map<string, number>()
  const droppableByTeam = new Map<string, Set<string>>()
  let unreadDropTeams = new Set<string>()

  if (kind === 'pickup') {
    const { rows: dropRows, unreadIds } = await selectByIdBatches<{ team_id: string }>(
      teamIds,
      'Failed to count team drops:',
      (batch) => serviceClient.from('team_drops').select('team_id').in('team_id', batch),
    )
    for (const row of dropRows) {
      dropsByTeam.set(row.team_id, (dropsByTeam.get(row.team_id) ?? 0) + 1)
    }
    unreadDropTeams = unreadIds

    const { rows: holdingRows } = await selectByIdBatches<{
      holding_id: string
      team_id: string
      movie_id: string
      release_date: string | null
      counterpicked_by_team_id: string | null
    }>(
      teamIds,
      'Failed to load droppable holdings:',
      (batch) =>
        serviceClient
          .from('team_holdings')
          .select('holding_id, team_id, movie_id, release_date, counterpicked_by_team_id')
          .in('team_id', batch),
    )

    // One query for every pending counterpick auction touching these movies,
    // rather than one per holding.
    const movieIds = [...new Set(holdingRows.map((row) => row.movie_id))]
    const { rows: pendingCpBids } = await selectByIdBatches<{ movie_id: string }>(
      movieIds,
      'Failed to load pending counterpick bids:',
      (batch) =>
        serviceClient
          .from('counterpick_bids')
          .select('movie_id')
          .in('status', ['active', 'outbid'])
          .in('movie_id', batch),
    )
    const contestedMovieIds = new Set(pendingCpBids.map((row) => row.movie_id))

    const today = new Date().toISOString().slice(0, 10)
    const candidatesByTeam = new Map<string, DroppableCandidate[]>()
    for (const row of holdingRows) {
      const bucket = candidatesByTeam.get(row.team_id) ?? []
      bucket.push({
        holdingId: row.holding_id,
        releaseDate: row.release_date,
        counterpickedByTeamId: row.counterpicked_by_team_id,
        hasPendingCounterpickBid: contestedMovieIds.has(row.movie_id),
      })
      candidatesByTeam.set(row.team_id, bucket)
    }

    for (const [teamId, candidates] of candidatesByTeam) {
      const league = leagueById.get(leagueOfTeam.get(teamId) ?? '')
      droppableByTeam.set(
        teamId,
        droppableHoldingIds(candidates, {
          today,
          counterpicksBlockDrops: league?.counterpicks_block_drops ?? true,
        }),
      )
    }
  }

  for (const [teamId, leagueId] of leagueOfTeam) {
    const league = leagueById.get(leagueId)
    const unreadable =
      unreadUsedTeams.has(teamId) || unreadBudgetTeams.has(teamId) || unreadDropTeams.has(teamId)

    if (unreadable || !league) {
      capacities.set(teamId, {
        freeSlots: 0,
        remainingBudget: 0,
        remainingDrops: 0,
        droppableHoldingIds: new Set(),
      })
      continue
    }

    const totalSlots =
      kind === 'counterpick' ? (league.bidding_counterpick_slots ?? 0) : (league.total_slots ?? 0)

    capacities.set(teamId, {
      freeSlots: Math.max(0, totalSlots - (usedByTeam.get(teamId) ?? 0)),
      remainingBudget: budgetByTeam.get(teamId) ?? 0,
      remainingDrops: Math.max(0, (league.drop_limit ?? 0) - (dropsByTeam.get(teamId) ?? 0)),
      droppableHoldingIds: droppableByTeam.get(teamId) ?? new Set(),
    })
  }

  return { capacities, slotsByLeague }
}
```

- [ ] **Step 2: Point the counterpick call site at it**

At `process-bids/index.ts:1084`, replace:

```ts
const { remaining, slotsByLeague } = await getRemainingCounterpickSlots(serviceClient, contests)
```

with:

```ts
const { capacities, slotsByLeague } = await getTeamCapacities(serviceClient, contests, 'counterpick')
const { winners, lossReasons } = resolveBidWinners(contests, capacities)
```

and delete the now-redundant `resolveCounterpickWinners(contests, remaining)` call that followed it. Line 1197's `slots: slotsByLeague.get(leagueId) ?? 0` needs no change — `slotsByLeague` still carries the league's total counterpick allowance, which is what that email copy quotes.

- [ ] **Step 3: Type-check and run the suite**

Run: `cd supabase/functions && deno check process-bids/index.ts && cd ../.. && npm run test:functions`
Expected: no type errors; suite passes except the known-failing `process-bids-dropped-targets.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-bids/index.ts
git commit -m "Replace counterpick slot lookup with multi-dimensional capacity assembly"
```

---

### Task 5: Batched pickup resolution and conditional drop execution

Replace the independent per-movie loop at `process-bids/index.ts:1482` with collect → resolve → award. Movie find-or-create, the release-date revalidation that voids a whole group, and every notification path stay exactly where they are; only winner selection moves.

**Files:**
- Modify: `supabase/functions/process-bids/index.ts:1482-1750` (approx)

**Interfaces:**
- Consumes: `resolveBidWinners`, `getTeamCapacities`, `BidContest`, `BidLossReason`.
- Produces: `executeConditionalDrop(serviceClient, holdingId, teamId, movieId): Promise<boolean>`.

- [ ] **Step 1: Add the drop executor**

Mirrors `drop-movie` exactly: insert `team_drops`, then set `dropped_at` on the source row. `team_holdings` does not say which base table a holding came from, so the pickup leg is tried first and the draft leg second — `holding_id` is a UUID, so there is no ambiguity about which one matches.

```ts
/**
 * Release a holding as part of awarding a bid that named it as a conditional
 * drop. Mirrors drop-movie: a team_drops row (which is what get_team_drop_count
 * reads, so drop_limit is charged) plus dropped_at on the source row.
 *
 * @returns false if the drop could not be completed, in which case the caller
 *   must not award the bid -- awarding without the drop puts the team over cap.
 */
async function executeConditionalDrop(
  serviceClient: ServiceClient,
  holdingId: string,
  teamId: string,
  movieId: string,
): Promise<boolean> {
  const droppedAt = new Date().toISOString()

  const { data: pickupRow } = await serviceClient
    .from('pickups')
    .select('id')
    .eq('id', holdingId)
    .is('dropped_at', null)
    .maybeSingle()

  const isPickup = !!pickupRow
  const table = isPickup ? 'pickups' : 'draft_picks'

  const { error: recordError } = await serviceClient.from('team_drops').insert({
    team_id: teamId,
    movie_id: movieId,
    pickup_id: isPickup ? holdingId : null,
    draft_pick_id: isPickup ? null : holdingId,
    dropped_at: droppedAt,
  })

  if (recordError) {
    log.error('Failed to record conditional drop', {
      holding_id: holdingId,
      error: serializeError(recordError),
    })
    return false
  }

  const { error: updateError } = await serviceClient
    .from(table)
    .update({ dropped_at: droppedAt })
    .eq('id', holdingId)
    .is('dropped_at', null)

  if (updateError) {
    log.error('Failed to mark holding dropped; rolling back drop record', {
      holding_id: holdingId,
      error: serializeError(updateError),
    })
    await serviceClient.from('team_drops').delete()
      .eq(isPickup ? 'pickup_id' : 'draft_pick_id', holdingId)
    return false
  }

  return true
}
```

- [ ] **Step 2: Build contests before the award loop**

After `contestedKeys` is computed and before the existing `for (const key of contestedKeys)` loop, gather each group, skip those with an open counter window (the existing `latestOpenResponseDeadline` / `deferred` logic moves here unchanged), and shape the survivors into contests:

```ts
// Every due group's active bids, gathered before any award, so capacity is
// decided against the whole week rather than movie-by-movie. Resolving them
// independently is what let a team win more movies than it had room or budget
// for.
const contests: BidContest[] = []
const bidsByKey = new Map<string, PickupBid[]>()

for (const key of contestedKeys) {
  const [leagueId, tmdbIdStr] = key.split(':')
  const tmdbId = parseInt(tmdbIdStr)

  const { data: allBidsForMovie } = await serviceClient
    .from('pickup_bids')
    .select('*')
    .eq('league_id', leagueId)
    .eq('tmdb_id', tmdbId)
    .in('status', ['active', 'outbid'])

  const movieBids: PickupBid[] = allBidsForMovie || []
  bidsByKey.set(key, movieBids)

  const openWindowEnds = latestOpenResponseDeadline(movieBids, now)
  if (openWindowEnds) {
    const titledBid = movieBids.find((bid) => bid.movie_data?.title)
    deferred.push({
      league_id: leagueId,
      movie_title: titledBid?.movie_data?.title || `Movie #${tmdbId}`,
      counter_window_ends: openWindowEnds,
    })
    continue
  }

  const activeBids = movieBids.filter((b) => b.status === 'active')
  if (activeBids.length === 0) continue

  contests.push({
    key,
    activeBids: activeBids.map((bid) => ({
      id: bid.id,
      team_id: bid.team_id,
      amount: bid.amount,
      priority: bid.priority,
      created_at: bid.created_at,
      conditionalDropHoldingId:
        bid.conditional_drop_pickup_id ?? bid.conditional_drop_draft_pick_id ?? null,
    })),
  })
}

const pickupCapacities = await getTeamCapacities(serviceClient, contests, 'pickup')
const { winners: pickupWinners, lossReasons: pickupLossReasons, executedDrops } =
  resolveBidWinners(contests, pickupCapacities)
```

Add `priority`, `conditional_drop_draft_pick_id`, and `conditional_drop_pickup_id` to the `PickupBid` interface at the top of the file.

- [ ] **Step 3: Rewrite the award loop to consult the resolution**

The loop now iterates `contests` rather than `contestedKeys`. Replace the block that sorted `activeBids` and took `activeBids[0]` with a lookup:

```ts
for (const contest of contests) {
  const key = contest.key
  const allBidsForMovie = bidsByKey.get(key) ?? []
  const resolved = pickupWinners.get(key)

  // No winner: every contender was out of room, budget, or drops. Leave the
  // bids pending -- a later run can award them once capacity frees up --
  // exactly as an unawarded counterpick contest behaves.
  if (!resolved) continue

  const winner = allBidsForMovie.find((bid) => bid.id === resolved.id)!
  const movieTitle = winner.movie_data?.title || `Movie #${winner.tmdb_id}`
  // ... existing movie find-or-create and release-date revalidation, unchanged
```

Immediately before the `pickups` insert, execute the conditional drop if the resolver funded the award with one. Drop first, then insert: a failure between them leaves the team **under** its cap rather than over it.

```ts
  const dropHoldingId = executedDrops.get(winner.id)
  if (dropHoldingId) {
    const dropped = await executeConditionalDrop(
      serviceClient, dropHoldingId, winner.team_id, movieId,
    )
    if (!dropped) {
      // Without the drop this award would put the team over cap. Leave the bid
      // pending for the next run rather than awarding it anyway.
      errors.push({ movie_key: key, error: 'Failed to execute conditional drop' })
      continue
    }
  }
```

Then the existing `pickups` insert, `deductTeamBudget`, `status: 'won'`, and notifications run unchanged.

- [ ] **Step 4: Use the resolver's loss reasons in loser notifications**

Where losers are marked and notified, the reason now comes from the resolution rather than being assumed to be "outbid":

```ts
const reason: BidLossReason = pickupLossReasons.get(loserBid.id) ?? 'outbid'
const body = reason === 'outbid'
  ? `Your bid of $${loserBid.amount} was not enough. The winning bid was $${winner.amount}.`
  : reason === 'insufficient_budget'
    ? `Your bid of $${loserBid.amount} on ${movieTitle} could not be honored — your remaining Fantasy Budget was already committed to higher-priority bids.`
    : `Your bid of $${loserBid.amount} on ${movieTitle} could not be honored — your roster was full and no conditional drop was available.`
```

Note the Global Constraint: "Fantasy Budget", never "FAAB".

- [ ] **Step 5: Write the integration test**

Create `supabase/functions/tests/process-bids-conditional-drops.test.ts`, following the setup helpers in `tests/_setup.ts` and the structure of `tests/process-bids.test.ts`. Cover:

1. A team at a full roster with a conditional drop wins: `pickups` gains the new movie, the named holding has `dropped_at` set, and `team_drops` gains exactly one row.
2. The same team's losing bid with a conditional drop leaves its roster untouched — no `team_drops` row, no `dropped_at`.
3. A team at a full roster with no conditional drop does not win; the runner-up does.
4. A team leading two contests with one free slot wins only its priority-1 bid.

Use valid UUIDs (8-4-4-4-12 hex) — `isValidUUID` rejects anything else.

- [ ] **Step 6: Run the tests**

Run: `cd supabase/functions && PROCESS_BIDS_URL=http://127.0.0.1:8000 deno test --allow-all tests/process-bids-conditional-drops.test.ts`
Expected: PASS. Requires local Supabase running.

- [ ] **Step 7: Run the full suite**

Run: `npm run test:functions`
Expected: PASS except the known-failing `process-bids-dropped-targets.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/process-bids/index.ts supabase/functions/tests/process-bids-conditional-drops.test.ts
git commit -m "Resolve pickup bids as a batch with capacity and conditional drops"
```

---

### Task 6: `place-bid` — drop the slot gate, accept a conditional drop

**Files:**
- Modify: `supabase/functions/place-bid/index.ts:129-136` (remove), plus request parsing and insert/update
- Test: `supabase/functions/tests/place-bid.test.ts` (extend, or create if absent)

**Interfaces:**
- Consumes: the migration's columns.
- Produces: `place-bid` request body gains optional `conditional_drop_draft_pick_id?: string` and `conditional_drop_pickup_id?: string`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/tests/place-bid.test.ts` already exists. It imports `createTestFactory`, `getAnonClient`, `getServiceClient`, `uniqueName`, `invokeFunction` from `./_setup.ts`, generates collision-free ids via its local `uniqueVoidTestTmdbId()`, and routes through `PLACE_BID_URL` when set. Reuse all of that — do not introduce parallel helpers.

Add three cases inside the existing suite, using its established factory calls to build a league whose team already holds `total_slots` movies:

```ts
await t.step('accepts a bid when the roster is full', async () => {
  // The slot gate is gone: a full roster no longer ends a team's season as a
  // bidder. An unwinnable bid loses at processing with reason 'no_slots'
  // instead of being refused a week early.
  const { status } = await callPlaceBid(client, {
    league_id: leagueId,
    tmdb_id: uniqueVoidTestTmdbId(),
    amount: 5,
    movie_data: testMovieData,
  })
  assertEquals(status, 201)
})

await t.step('rejects a conditional drop the team does not hold', async () => {
  const { status } = await callPlaceBid(client, {
    league_id: leagueId,
    tmdb_id: uniqueVoidTestTmdbId(),
    amount: 5,
    movie_data: testMovieData,
    conditional_drop_pickup_id: otherTeamPickupId,
  })
  assertEquals(status, 400)
})

await t.step('rejects two conditional drop targets', async () => {
  const { status } = await callPlaceBid(client, {
    league_id: leagueId,
    tmdb_id: uniqueVoidTestTmdbId(),
    amount: 5,
    movie_data: testMovieData,
    conditional_drop_pickup_id: myPickupId,
    conditional_drop_draft_pick_id: myDraftPickId,
  })
  assertEquals(status, 400)
})
```

`callPlaceBid` here is whatever the file already uses to invoke the function (`invokeFunction` or its local `fetch` wrapper) — match the surrounding cases rather than adding a new one. `myPickupId` / `otherTeamPickupId` / `myDraftPickId` come from the rows the factory created; capture them when seeding the full roster.

- [ ] **Step 2: Run to verify they fail**

Run: `cd supabase/functions && PLACE_BID_URL=http://127.0.0.1:8000 deno test --allow-all tests/place-bid.test.ts`
Expected: FAIL — the full-roster case returns 400 "No pickup slots available"; the conditional-drop cases are ignored.

- [ ] **Step 3: Remove the gate and validate the new fields**

Delete lines 129-136 of `place-bid/index.ts` (the comment through the closing brace of the `No pickup slots available` check). Add to the request interface:

```ts
interface PlaceBidRequest {
  league_id: string
  tmdb_id: number
  amount: number
  movie_data?: MovieData
  /** Holding released only if this bid wins. At most one may be set. */
  conditional_drop_draft_pick_id?: string | null
  conditional_drop_pickup_id?: string | null
}
```

After the team is resolved and before the movie lookup:

```ts
// A conditional drop names a holding released only if this bid wins. Validate
// ownership here; whether it is still *droppable* is re-checked at processing
// time, because a week can pass and the movie can release or be counterpicked.
if (conditional_drop_draft_pick_id && conditional_drop_pickup_id) {
  return errorResponse('Provide only one conditional drop target', 400)
}

const conditionalDropId = conditional_drop_draft_pick_id ?? conditional_drop_pickup_id ?? null

if (conditionalDropId) {
  if (!isValidUUID(conditionalDropId)) {
    return errorResponse('Conditional drop target must be a valid id', 400)
  }

  const expectedSource = conditional_drop_pickup_id ? 'pickup' : 'draft'
  const { data: holding } = await serviceClient
    .from('team_holdings')
    .select('holding_id')
    .eq('holding_id', conditionalDropId)
    .eq('team_id', team.id)
    .eq('source', expectedSource)
    .maybeSingle()

  if (!holding) {
    return errorResponse('You can only conditionally drop a movie your team currently holds', 400)
  }
}
```

Add both columns to the `insert({...})` payload, and to the `update({...})` payload on the existing-bid branch so a re-bid can change or clear the target:

```ts
conditional_drop_draft_pick_id: conditional_drop_draft_pick_id ?? null,
conditional_drop_pickup_id: conditional_drop_pickup_id ?? null,
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd supabase/functions && PLACE_BID_URL=http://127.0.0.1:8000 deno test --allow-all tests/place-bid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/place-bid/index.ts supabase/functions/tests/place-bid.test.ts
git commit -m "Allow bidding at a full roster and accept conditional drop targets"
```

---

### Task 7: `set-bid-priorities` Edge Function

A near-copy of `set-counterpick-bid-priorities` against `pickup_bids`. Read that file first — the validation sequence (full-set requirement, ownership check, dense 1..N rewrite) is deliberate and should be reproduced, not reinvented.

**Files:**
- Create: `supabase/functions/set-bid-priorities/index.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/functions/tests/set-bid-priorities.test.ts`

**Interfaces:**
- Consumes: `pickup_bids.priority`.
- Produces: `POST /functions/v1/set-bid-priorities` → `{ league_id: string, bid_ids: string[] }` → `{ bids: PickupBid[], message: string }`.

- [ ] **Step 1: Add the config entry first**

Skipping this yields `{"code":401,"message":"Invalid JWT"}` in production even with a valid token. Add to `supabase/config.toml`, next to the other function blocks:

```toml
[functions.set-bid-priorities]
verify_jwt = false
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/tests/set-bid-priorities.test.ts` as a structural copy of `tests/set-counterpick-bid-priorities.test.ts`. That file's shape is what to reproduce: a single `Deno.test` with `sanitizeResources: false, sanitizeOps: false`, `const { client, secondClient, factory } = await createTestFactory()`, a local `callAs(userClient, body)` that fetches `FUNCTION_URL` with the session's access token, and a `prioritiesByBid(leagueId, teamId)` reader. Substitute `pickup_bids` for `counterpick_bids` in the reader, and default `FUNCTION_URL` to `${SUPABASE_URL}/functions/v1/set-bid-priorities` with the `PRIORITIES_URL` override.

The `t.step` cases:

```ts
await t.step('rewrites priorities to the given order', async () => {
  // Bids seeded in order A, B, C; ask for C, A, B.
  const { status } = await callAs(client, { league_id: leagueId, bid_ids: [cId, aId, bId] })
  assertEquals(status, 200)

  const priorities = await prioritiesByBid(leagueId, teamId)
  assertEquals(priorities[cId], 1)
  assertEquals(priorities[aId], 2)
  assertEquals(priorities[bId], 3)
})

await t.step('rejects a partial list', async () => {
  // Omitted bids would keep stale numbers and the caller could not tell where
  // they landed, so the full set is required.
  const { status } = await callAs(client, { league_id: leagueId, bid_ids: [aId] })
  assertEquals(status, 400)
})

await t.step("rejects another team's bid", async () => {
  const { status } = await callAs(client, {
    league_id: leagueId,
    bid_ids: [aId, bId, otherTeamBidId],
  })
  assertEquals(status, 400)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd supabase/functions && PRIORITIES_URL=http://127.0.0.1:8000 deno test --allow-all tests/set-bid-priorities.test.ts`
Expected: FAIL — the function does not exist.

- [ ] **Step 4: Implement**

Create `supabase/functions/set-bid-priorities/index.ts` as a copy of `set-counterpick-bid-priorities/index.ts` with these substitutions and nothing else changed:

- `createLogger('set-bid-priorities')`
- table `'counterpick_bids'` → `'pickup_bids'` (three occurrences: two in `loadPendingBids`, one in the update)
- error strings: "pending counterpick bids" → "pending bids"
- the header doc comment retargeted at pickups, pointing to `_shared/bid-resolution.ts` and this plan's spec

- [ ] **Step 5: Run to verify it passes**

Run: `cd supabase/functions && PRIORITIES_URL=http://127.0.0.1:8000 deno test --allow-all tests/set-bid-priorities.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/set-bid-priorities supabase/functions/tests/set-bid-priorities.test.ts supabase/config.toml
git commit -m "Add set-bid-priorities endpoint for reordering pickup bids"
```

---

### Task 8: Frontend data layer — pooled slots and the priority action

**Files:**
- Modify: `apps/frontend/types/index.ts:388-400`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/bidding/layout.tsx:89-104`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/bidding/BiddingContext.ts:19`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/bidding/BiddingShell.tsx:55-75, 111-113, 202`

**Interfaces:**
- Consumes: `set-bid-priorities` from Task 7.
- Produces:
  - `PickupBid` gains `priority: number`, `conditional_drop_draft_pick_id: string | null`, `conditional_drop_pickup_id: string | null`.
  - `UseBiddingReturn` gains `setBidPriorities: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>` and `myBids` sorted by priority.
  - `BiddingShell` props: `usedPickupSlots` → `usedRosterSlots`, plus `myHoldings: DroppableHolding[]`.
  - `DroppableHolding = Pick<TeamHolding, 'holding_id' | 'source' | 'title' | 'release_date' | 'counterpicked_by_team_id' | 'poster_url'>` — exported from `apps/frontend/types/index.ts`.

- [ ] **Step 1: Extend the types**

In `apps/frontend/types/index.ts`, add to `PickupBid`:

```ts
  /** Team-chosen rank among its own pending bids; 1 is the one it wants most. */
  priority: number
  /** Holding released only if this bid wins. At most one is ever set. */
  conditional_drop_draft_pick_id: string | null
  conditional_drop_pickup_id: string | null
```

And near `TeamHolding`:

```ts
/** The `team_holdings` columns the conditional-drop picker needs. */
export type DroppableHolding = Pick<
  TeamHolding,
  'holding_id' | 'source' | 'title' | 'release_date' | 'counterpicked_by_team_id' | 'poster_url'
>
```

- [ ] **Step 2: Add `setBidPriorities` and sort `myBids`**

In `useBidding.ts`, add to `UseBiddingReturn`:

```ts
  /** Rewrites the team's pickup bid priorities to the given order, most wanted first. */
  setBidPriorities: (bidIds: string[]) => Promise<{ success: boolean; error?: string }>
```

Add the action next to `setCounterpickBidPriorities`:

```ts
  const setBidPriorities = useCallback(async (
    bidIds: string[]
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: priorityError } = await callEdgeFunction('set-bid-priorities', {
      body: { league_id: leagueId, bid_ids: bidIds },
    })

    if (priorityError) {
      return { success: false, error: priorityError }
    }

    await refetch()
    return { success: true }
  }, [leagueId, refetch])
```

Change `myBids` to sort by priority, matching how `myCounterpickBids` already does it:

```ts
  // Priority order is the order the team chose, so surface it that way everywhere.
  const myBids = useMemo(
    () => bids
      .filter(bid => bid.team_id === teamId)
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    [bids, teamId]
  )
```

Add `setBidPriorities` to the returned object.

- [ ] **Step 3: Switch the layout to a pooled count and pass holdings**

In `bidding/layout.tsx`, widen the `HoldingRow` type and the select, then replace the pickup-only count:

```ts
type HoldingRow = Pick<
  TeamHolding,
  'team_id' | 'source' | 'tmdb_id' | 'holding_id' | 'title'
  | 'release_date' | 'counterpicked_by_team_id' | 'poster_url'
>
```

```ts
supabase.from('team_holdings').select(
  `team_id, source, tmdb_id, holding_id, title, release_date, counterpicked_by_team_id, poster_url`
).eq('league_id', id),
```

```ts
  const ownedTmdbIds = [...new Set(holdings.map((holding) => holding.tmdb_id))]

  // Pooled roster: draft picks and pickups share total_slots, so dropping a
  // drafted movie frees room for a pickup. That is what makes a conditional
  // drop useful -- the movie a team most wants to swap out is usually one it
  // drafted badly.
  const myHoldings = holdings.filter((holding) => holding.team_id === team.id)
  const usedRosterSlots = myHoldings.length
```

Pass `usedRosterSlots={usedRosterSlots}` and `myHoldings={myHoldings}` to `BiddingShell`.

- [ ] **Step 4: Update BiddingShell and the context**

In `BiddingContext.ts`, rename `usedPickupSlots: number` → `usedRosterSlots: number`.

In `BiddingShell.tsx`:
- Rename the prop and every use (lines 82, 95, 156, 171, 202).
- Add `myHoldings: DroppableHolding[]` to `Props` and thread it to `PlaceBidModal`.
- Replace the capacity math at 111-113:

```ts
  const rosterSlots = league.total_slots
  const remainingBudget = budget?.remaining_budget ?? 100
  const freeRosterSlots = Math.max(0, rosterSlots - usedRosterSlots)
```

- Delete `canPlaceBid` entirely and remove it from `getBidCtaTitle`, including the line `if (!canPlaceBid) return 'All pickup slots are full — drop a movie to bid again'`. A full roster no longer disables the button. `getBidCtaTitle` keeps only the counter-bid-phase branch:

```ts
/** Why the bid button is disabled, or undefined when it isn't. */
function getBidCtaTitle(
  isCounterBidPhase: boolean,
  hasContestedBids: boolean,
): string | undefined {
  if (isCounterBidPhase && !hasContestedBids) {
    return 'New bids are closed and no movies are currently being bid on'
  }
  return undefined
}
```

- Line 202 becomes `<SlotStat label="Roster" used={usedRosterSlots} total={rosterSlots} />`.

- [ ] **Step 5: Type-check and build**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no errors. Fix any remaining `usedPickupSlots` / `canPlaceBid` references it reports.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/types/index.ts "apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts" "apps/frontend/app/(authenticated)/league/[id]/bidding"
git commit -m "Pool roster slots on the bidding page and add the priority action"
```

---

### Task 9: Frontend UI — conditional drop picker, priority list, bid card

**REQUIRED SUB-SKILL:** invoke the `frontend-design` skill before writing any of this task's components, per the project's UI workflow.

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/BidPriorityList.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/BidCard.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/ActiveBidsPanel.tsx:216-228`

**Interfaces:**
- Consumes: `DroppableHolding`, `PickupBid.priority`, `setBidPriorities`, `freeRosterSlots`.
- Produces: `PlaceBidModal.onPlaceBid` widens to
  `(tmdbId: number, amount: number, movieData: Record<string, unknown>, conditionalDrop?: { source: 'draft' | 'pickup'; holdingId: string } | null) => Promise<{ success: boolean; error?: string }>`.
  `useBidding.placeBid` gains the same fourth parameter and maps it onto the two body fields.

- [ ] **Step 1: Build `BidPriorityList.tsx`**

Copy `CounterpickPriorityList.tsx` and adapt. Keep the debounce, the `lastSaved` echo guard (it stops the server round-trip from fighting the local order), the `order.length < 2` early return, and the "Slots run out" cut line — all three are load-bearing.

Changes: prop type `PickupBid[]`; `data-testid="bid-priority-list"` and `data-testid="bid-slot-cut-line"`; title "Bid priority"; movie title read from `bid.movie_data?.title`; and this copy:

```tsx
        <p className="text-sm text-foreground-secondary">
          {remainingSlots > 0
            ? `If more of your bids win than you have room for, you keep the top ${remainingSlots}.`
            : 'Your roster is full, so these bids will only be honored if you attach a drop or free a slot.'}
        </p>
```

Props are `{ bids: PickupBid[]; slots: number; used: number; onReorder: (bidIds: string[]) => Promise<{ success: boolean; error?: string }> }`, matching the counterpick component exactly.

- [ ] **Step 2: Mount it in `ActiveBidsPanel.tsx`**

Directly above the existing `CounterpickPriorityList` block (line ~216). A **separate** list, not merged: the two draw on different capacity pools, so ranking them against each other means nothing.

```tsx
      {/* Bid priority: which pickups the team keeps if more of its bids win
          than it has roster room for. Separate from the counterpick list --
          different capacity pool, so a combined ranking would be meaningless. */}
      <BidPriorityList
        bids={myBids}
        slots={rosterSlots}
        used={usedRosterSlots}
        onReorder={setBidPriorities}
      />
```

Thread `myBids`, `rosterSlots`, `usedRosterSlots`, and `setBidPriorities` through `ActiveBidsPanel`'s props from `BiddingShell`.

- [ ] **Step 3: Add the conditional drop picker to `PlaceBidModal.tsx`**

Add props:

```tsx
  /** The team's active holdings, offered as conditional drop targets. */
  myHoldings: DroppableHolding[]
  /** Roster slots still open. Zero means a bid needs a conditional drop to land. */
  freeRosterSlots: number
```

Add state `const [dropHoldingId, setDropHoldingId] = useState<string | null>(null)`, reset to `null` whenever the modal opens or the selected movie changes.

Render below the amount input, gated on `myHoldings.length > 0`: a labelled `<select className="input">` with a "Don't drop anything" default plus one option per holding (`{holding.title}`). Then the warning the spec calls for:

```tsx
{freeRosterSlots === 0 && !dropHoldingId && (
  <div className="alert alert-warning" data-testid="full-roster-warning">
    Your roster is full. You can still place this bid, but it can only be
    honored if you attach a drop above or a slot frees up before bids are
    processed.
  </div>
)}
```

It warns; it must not disable the submit button. A slot can free up before processing — a trade, a manual drop, another of this team's own conditional drops — and refusing the bid a week early forecloses that.

Pass the selection through on submit:

```tsx
const holding = myHoldings.find((h) => h.holding_id === dropHoldingId)
await onPlaceBid(movie.tmdb_id, amount, movieData,
  holding ? { source: holding.source, holdingId: holding.holding_id } : null)
```

- [ ] **Step 4: Widen `placeBid` in `useBidding.ts`**

```ts
  const placeBid = useCallback(async (
    tmdbId: number,
    amount: number,
    movieData?: Record<string, unknown>,
    conditionalDrop?: { source: 'draft' | 'pickup'; holdingId: string } | null,
  ): Promise<{ success: boolean; error?: string }> => {
    const { error: bidError } = await callEdgeFunction('place-bid', {
      body: {
        league_id: leagueId,
        tmdb_id: tmdbId,
        amount,
        movie_data: movieData,
        conditional_drop_draft_pick_id:
          conditionalDrop?.source === 'draft' ? conditionalDrop.holdingId : null,
        conditional_drop_pickup_id:
          conditionalDrop?.source === 'pickup' ? conditionalDrop.holdingId : null,
      },
    })
    // ... existing error handling, trackEvent, refetch
```

Update the `UseBiddingReturn.placeBid` signature to match.

- [ ] **Step 5: Show the drop on `BidCard.tsx`**

Add an optional `dropTitle?: string | null` prop (resolved by the parent from `myHoldings`), rendered as a chip beside the amount when present:

```tsx
{dropTitle && (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-bg/30 text-warning border border-warning/20"
    data-testid="conditional-drop-chip"
  >
    <Scissors className="w-3 h-3" />
    Drops {dropTitle} if won
  </span>
)}
```

`Scissors` comes from `lucide-react`, as in `CounterpickPriorityList`.

- [ ] **Step 6: Type-check and build**

Run: `cd apps/frontend && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add "apps/frontend/app/(authenticated)/league/[id]/components" "apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts"
git commit -m "Add conditional drop picker, bid priority list, and drop chip"
```

---

### Task 10: Settings copy, simplify, verify

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/settings/components/BiddingConfigSection.tsx:89, 125-131, 197-202`
- Modify: `apps/frontend/app/components/CreateLeagueModal.tsx:128, 350-353`
- Modify: `CLAUDE.md` (bidding section)

- [ ] **Step 1: Update the settings copy for the pooled model**

`pickupSlots = totalSlots - draftSlots` is no longer a separate pool — it is how many roster slots the draft leaves open. Reword so it describes a shared roster:

```tsx
{pickupSlots > 0
  ? `Teams draft ${draftSlots} and fill the remaining ${pickupSlots} of ${totalSlots} roster slots by bidding — or by dropping a movie and bidding on a replacement`
  : 'The draft fills every roster slot. Teams can still bid by dropping a movie first.'}
```

Apply the equivalent change to `CreateLeagueModal.tsx:350-353`. Check no string says "FAAB".

- [ ] **Step 2: Document the feature in CLAUDE.md**

In the Bidding System section, after "Bid Lifecycle", add:

```markdown
### Bid priority and conditional drops

Teams may bid past a full roster. Two mechanisms keep that safe, both mirroring
the counterpick system:

- `pickup_bids.priority` ranks a team's own pending bids (1 = wanted most). It
  never decides who wins a contest — the highest bid does. It decides which of
  a team's own winning bids it keeps when it wins more than it has room for.
  Priorities are not unique; gaps and duplicates normalize at processing time.
- `pickup_bids.conditional_drop_draft_pick_id` / `conditional_drop_pickup_id`
  name a holding released only if that bid wins. `drop_limit` is charged only
  on execution. A target that has become undroppable (released, counterpicked,
  traded away) degrades the bid to a plain one rather than voiding it.

Roster slots are **pooled**: capacity is `total_slots` minus all active
holdings from `team_holdings`, draft picks and pickups alike. `draft_slots`
only governs how many arrive in the draft.

`_shared/bid-resolution.ts` resolves both bid types — every contest together,
at most one award per team per pass, then re-check capacity. Do not go back to
resolving contests independently: that is what let teams exceed both their
roster cap and their budget.
```

- [ ] **Step 3: Run the code-simplifier**

Per the project workflow, this runs on all modified code **before** verification, so verification sees the final state.

Run the `code-simplifier:code-simplifier` agent over the files changed in Tasks 1–10.

- [ ] **Step 4: Re-run the Deno suite after simplification**

Required by the project's coordination rules: if tests fail after simplification, review the simplifier's changes before proceeding.

Run: `npm run test:functions`
Expected: PASS except the known-failing `process-bids-dropped-targets.test.ts`.

- [ ] **Step 5: Restart the dev server and verify in the browser**

```bash
npm run dev
```

Then with `mcp__claude-in-chrome__*`:
1. Log in at `http://localhost:3000/login` as `alice@fantasyreel.test` / `testpass123!`.
2. Open a league's bidding page. Confirm the stat reads "Roster" against `total_slots`.
3. With a full roster, confirm the bid button is **enabled**.
4. Open the bid modal, pick a movie, confirm the full-roster warning appears, then select a conditional drop and confirm it disappears.
5. Place two bids and reorder them in the priority list; confirm the order persists after a reload.
6. Check `mcp__claude-in-chrome__read_console_messages` for errors.

Do not open detail modals for seeded tmdb_ids 999001/999002 — they resolve to real TMDb entries, one of which is an adult film.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Update slot copy for pooled roster and document bid priority"
```

---

## Notes for the executor

- **Do not add a proposal-time uniqueness check** on bids or trade movies. A trigger and unique index used to do that and were deliberately dropped in `20260809120000_allow_competing_trades.sql`. Late re-validation is what protects the data.
- **Do not make `priority` unique.** Reordering would then need a transaction purely to avoid transient collisions. Normalization at resolution time is the design.
- **Keep `_shared/bid-resolution.ts` free of Supabase calls.** Its testability without a database is the reason the ordering rules are trustworthy.
- **Fail closed on every capacity read.** Withholding an award for one run is recoverable; awarding over cap is not.
