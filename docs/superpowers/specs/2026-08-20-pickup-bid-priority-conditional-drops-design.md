# Pickup Bid Priority and Conditional Drops

Date: 2026-08-20

Lets a team keep bidding once its roster is full, by ranking its own pending
bids and optionally attaching a drop that executes only if the bid wins.

## Problem

`place-bid` refuses outright when a team has no room:

```ts
// supabase/functions/place-bid/index.ts:129
const pickupSlots = league.total_slots - league.draft_slots
const { data: pickupCount } = await serviceClient
  .rpc('get_team_pickup_count', { p_team_id: team.id })

if ((pickupCount ?? 0) >= pickupSlots) {
  return errorResponse('No pickup slots available', 400)
}
```

A full roster therefore ends a team's season as a bidder. To re-enter the
auction it must drop a movie first, unconditionally, and hope the bid it wanted
is still winnable a week later. Fantasy Critic solves this with two mechanisms
we do not have for pickups: bids carry a **priority**, so a team may bid on more
movies than it has room for and say which wins it keeps; and a bid may name a
**conditional drop**, a movie released only if that bid succeeds.

Two further defects fall out of the same gap, both live today:

- **Pickup awards ignore capacity entirely.** `process-bids` resolves each movie
  independently in a `for` loop over `contestedKeys`
  (`supabase/functions/process-bids/index.ts:1482`), picking the highest bid with
  no reference to what the winner already holds. A team with one free slot that
  leads three auctions wins all three and ends the week over its cap.
- **Pickup awards ignore budget.** The same loop calls `deductTeamBudget` after
  the fact. A team leading three $40 auctions on a $100 budget wins all three
  and is driven negative.

Counterpicks already have the answer. `counterpick_bids.priority` (migration
`20260805150000_counterpick_bid_priority.sql`) and
`_shared/counterpick-resolution.ts` implement Fantasy Critic's ActionProcessor:
resolve every contest together, award at most one movie per team per pass, then
re-check capacity and repeat, so a team that runs out of room stops being a
contender and its movies fall through to the runner-up. That resolver is pure,
DB-free, and unit-tested. It is hardcoded to exactly one capacity dimension —
counterpick slots — which is the only reason pickups cannot use it.

## Solution

Three changes, in dependency order.

**1. One pooled roster.** Bidding capacity becomes `total_slots` minus *all*
active holdings, draft picks and pickups alike, rather than
`total_slots - draft_slots` minus pickups. Dropping a drafted movie then frees
room for a pickup, which is the whole point of a conditional drop: the movie a
team most wants to swap out is usually one it drafted badly. This matches
Fantasy Critic's single game-slot roster.

**2. Priority on pickup bids.** `pickup_bids.priority`, per team per league,
`1` meaning wanted most. It never decides who *wins* a contest — the highest
bid still does that. It decides only which of a team's own winning bids it can
afford to keep when it wins more than it has room for.

**3. Conditional drops.** A bid may name one holding the team owns. If the bid
wins, that holding is dropped in the same operation and the bid is
slot-neutral. If the bid loses, nothing happens and nothing is charged.

### Why bidding stays open at a full roster

Placing a bid with a full roster and no conditional drop is permitted, not
rejected. A slot can free up before processing — a trade, a manual drop,
another of the team's own conditional drops — and a bid placed on the
expectation of that should not have been refused a week earlier. If no slot
materialises, the bid simply loses with reason `no_slots`, exactly as an
over-cap counterpick bid does today.

The UI warns rather than blocks: `PlaceBidModal` shows an `.alert-warning` when
free slots are zero and no conditional drop is selected.

### Why the drop is charged only on execution

`leagues.drop_limit` (default 2) caps drops per team per season. A conditional
drop that never fires costs nothing — no movie left the roster. Charging at bid
time would mean reconciling refunds on every cancel, outbid, and loss, for no
gain. Charging on execution keeps `drop_limit` meaningful and makes a
conditional drop cost exactly what the equivalent manual drop costs.

The consequence is that a team may have more pending conditional drops than
remaining drop allowance. That is fine and is resolved at processing time:
remaining drops are a capacity dimension like any other, so bids past the
allowance fall through in priority order.

## Scope

In scope: pickup bid priority, conditional drops, pooled slot accounting,
capacity-aware resolution for pickups **and** counterpicks (slots + budget +
drops).

Not in scope: counterpick conditional drops, trading a conditional drop
obligation, changing `bidding_counterpick_slots` accounting, renaming
`get_team_pickup_count` (left in place for other callers).

## Components

### 1. Migration — `20260820…_pickup_bid_priority_and_conditional_drops.sql`

```sql
ALTER TABLE pickup_bids
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conditional_drop_draft_pick_id UUID
    REFERENCES draft_picks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conditional_drop_pickup_id UUID
    REFERENCES pickups(id) ON DELETE SET NULL,
  ADD CONSTRAINT check_one_conditional_drop CHECK (
    conditional_drop_draft_pick_id IS NULL
    OR conditional_drop_pickup_id IS NULL
  );
```

The two-column shape mirrors `counterpick_bids.draft_pick_id` /
`pickup_id`, which exists for the same reason: a holding lives in one of two
tables and both deserve real foreign keys. `ON DELETE SET NULL` degrades a bid
whose drop target vanished into a bid with no conditional drop, which is the
same fallback the resolver applies for a target that has merely become
undroppable.

`priority` is backfilled from the ordering `process-bids` applied implicitly,
so no existing bid changes outcome on the first run after deploy:

```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY league_id, team_id ORDER BY amount DESC, created_at ASC
  ) AS new_priority
  FROM pickup_bids WHERE status IN ('active', 'outbid')
)
UPDATE pickup_bids AS pb SET priority = ranked.new_priority
FROM ranked WHERE pb.id = ranked.id;
```

Plus the partial index supporting "this team's pending bids in priority order",
which both the reorder endpoint and the bidding page read on every load:

```sql
CREATE INDEX IF NOT EXISTS idx_pickup_bids_team_priority
  ON pickup_bids (league_id, team_id, priority)
  WHERE status IN ('active', 'outbid');
```

`priority` is deliberately **not** unique. Gaps and duplicates are tolerated and
normalized at resolution time, which keeps cancels and reorders from needing a
transaction just to avoid transient collisions — the reasoning is recorded on
the counterpick migration and applies unchanged.

### 2. `_shared/bid-resolution.ts` — the generalized resolver

`_shared/counterpick-resolution.ts` is renamed and its single integer capacity
widened to a record. Everything else — `compareBidStrength`,
`normalizeBidPriorities`, the per-pass "each team advances only its
highest-priority contender" loop — is unchanged.

```ts
export interface TeamCapacity {
  freeSlots: number
  remainingBudget: number
  remainingDrops: number
  /** Holdings still available to be conditionally dropped. */
  droppableHoldingIds: ReadonlySet<string>
}

export interface ResolvableBid {
  id: string
  team_id: string
  amount: number
  priority: number
  created_at: string
  /** Holding this bid drops if it wins, once validated. Null when absent or invalid. */
  conditionalDropHoldingId: string | null
}
```

`freeSlots` means "room for one more movie of this kind", and the two bid types
measure it against different pools: remaining `bidding_counterpick_slots` for
counterpick contests, pooled roster room for pickup contests. They never
collide, because pickups and counterpicks are resolved in separate calls with
their own capacity map. `remainingDrops` and `droppableHoldingIds` are always
zero and empty for counterpicks — conditional drops are a pickup-only feature —
which makes `canAfford` collapse to today's behaviour for that path.

Two pure functions replace the `remainingSlots.get(team) > 0` test:

- `canAfford(bid, capacity)` — `remainingBudget >= amount`, **and** either
  `freeSlots > 0`, or the bid carries a conditional drop whose holding is still
  in `droppableHoldingIds` and `remainingDrops > 0`.
- `consume(bid, capacity)` — always spends `amount` of budget. A plain award
  spends one slot. A conditional-drop award spends one drop and removes that
  holding from `droppableHoldingIds`, leaving `freeSlots` untouched: the movie
  arriving and the movie leaving cancel out.

Retiring the holding is what stops two of a team's bids from both cashing the
same drop target. The second bid finds its target gone, `canAfford` returns
false, and it falls through to the runner-up.

Loss reasons widen from `'outbid' | 'no_slots'` to
`'outbid' | 'no_slots' | 'insufficient_budget'`, so a bidder is told which
constraint actually stopped them.

The module stays free of Supabase calls, so all of this is testable without a
database — the property that makes the existing counterpick tests worth having.

### 3. Capacity assembly in `process-bids`

`getRemainingCounterpickSlots` generalizes to `getTeamCapacities`, keeping its
existing fail-closed contract: a team whose league config, holdings, budget, or
drop count could not be read is given zero capacity. That withholds awards for
one run, which a later run can still make — whereas reading a failed count as
"zero used" would hand out a full allowance on top of what the team already
holds, the exact over-cap outcome the function exists to prevent. The
`selectByIdBatches` / `unreadIds` machinery already implements this and is
reused as-is.

Capacity sources:

| Dimension | Source |
|---|---|
| `freeSlots` | `leagues.total_slots` − rows in `team_holdings` for the team |
| `remainingBudget` | `team_budgets.remaining_budget` |
| `remainingDrops` | `leagues.drop_limit` − `get_team_drop_count(team_id)` |
| `droppableHoldingIds` | holdings passing the validity rules below |

Counting from `team_holdings` rather than `pickups` is what makes the roster
pooled, and CLAUDE.md names that view the single read surface for active
rosters: it unions both tables and excludes dropped rows itself, so there is no
`dropped_at` filter to forget.

### 4. Conditional drop validity

Re-checked at processing against the same rules `drop-movie` enforces, because
a bid can sit pending for a week and the target can change underneath it:

1. Still held by the bidding team and not already dropped (it is in
   `team_holdings`).
2. Not released — `drop-movie` refuses `release_date < today`.
3. Not blocked by `leagues.counterpicks_block_drops`: neither
   `counterpicked_by_team_id` set, nor any `counterpick_bids` row on the movie
   in status `active` or `outbid`.

A target failing any of these is dropped from `droppableHoldingIds`, which
degrades the bid to one with no conditional drop. It can still win on a free
slot; with none it loses as `no_slots`, and the notification says the drop was
no longer possible rather than leaving the bidder to guess.

Falling back beats voiding the bid: the team's intent was to acquire the movie,
and the drop was the means. If a slot exists anyway, honouring the bid is what
they wanted.

### 5. Edge Function changes

**`place-bid`** — delete the slot rejection at `index.ts:129-136`. Accept
optional `conditional_drop_draft_pick_id` / `conditional_drop_pickup_id`,
validating that at most one is set and that it names a holding the caller's own
team currently holds (via `team_holdings`, filtered to the caller's team). An
update to an existing bid may change or clear the conditional drop. Everything
else — budget ceiling, release-date guard, eligibility, counter-bid phase,
outbid handling — is untouched.

**`process-bids`** — the pickup section stops resolving movies one at a time.
It collects due contests, calls `getTeamCapacities`, calls the shared resolver,
then awards. Movie find-or-create, the release-date revalidation that voids a
whole group, and every notification path stay where they are; only winner
selection moves. This makes the pickup path structurally identical to the
counterpick path directly below it in the same file.

Awarding a bid that carries a valid conditional drop performs the drop in the
same step, matching `drop-movie` exactly: insert `team_drops`, set `dropped_at`
on the source row. The `pickups` insert and the drop are ordered drop-first, so
a failure between them leaves the team under its cap rather than over it.

**`set-bid-priorities`** — new, mirroring `set-counterpick-bid-priorities`:
takes `{ league_id, bid_ids }` most-wanted-first, rewrites `priority` over the
caller's own pending bids. Needs a `config.toml` entry with
`verify_jwt = false` per the project-wide ES256 workaround, or it returns 401 in
production.

### 6. Frontend

**`PlaceBidModal.tsx`** — optional conditional-drop selector over the team's
active holdings, defaulting to none. When free slots are zero and nothing is
selected, an `.alert-warning`: the bid can still be placed, but cannot be
honoured unless a slot frees up before processing.

**`BidPriorityList.tsx`** — new, closely modelled on
`CounterpickPriorityList.tsx`, including the debounced save, the local-order
echo guard, and the "Slots run out" cut line. Rendered as a **separate** list
from the counterpick one: the two draw on different capacity pools, so ranking
them against each other has no meaning. Both live in `ActiveBidsPanel.tsx`.

**`BidCard.tsx`** — priority number, and a "Drops *X* if won" chip when the bid
carries a conditional drop.

**`BiddingShell.tsx:111-113`** — `canPlaceBid` gating is removed; `SlotStat`
reports pooled holdings against `total_slots`. The string at line 70,
`'All pickup slots are full — drop a movie to bid again'`, is deleted.

**`useBidding.ts`** — a `setBidPriorities` action alongside the counterpick one,
and the new bid fields threaded through. Both go through `callEdgeFunction` per
the observability conventions.

**`types/index.ts`** — `PickupBid` gains `priority` and the two conditional-drop
fields.

**Copy check:** no user-facing string may say "FAAB"; "Fantasy Budget" (or
"Budget" where space is tight) is the only permitted term.

### 7. Settings

`BiddingConfigSection.tsx` describes pickup slots as
`total_slots - draft_slots`. Under the pooled model that number is no longer a
separate pool, so the copy changes to describe `total_slots` as the roster size
and `draft_slots` as how many arrive in the draft, with the remainder available
via bidding *or* by dropping and replacing.

## Testing

**Resolver unit tests** (`_shared/bid-resolution.test.ts`, extending the
existing counterpick tests — pure, no database):

- A team leading three contests with one free slot wins its priority-1 bid; the
  other two fall to the runner-up, not to nobody.
- Budget exhaustion: three $40 leads on a $100 budget award two, in priority
  order, and the third falls through as `insufficient_budget`.
- Two of a team's bids naming the same conditional drop: the higher-priority one
  takes it, the other falls through.
- More conditional drops than `remaining_drops`: awarded in priority order up to
  the allowance.
- A conditional drop that fails validation degrades to a plain bid — wins if a
  slot is free, loses as `no_slots` if not.
- Duplicate and gapped priorities normalize deterministically (existing
  behaviour, re-asserted against the widened types).
- Counterpick regression: every existing case passes unchanged when budget and
  drops are non-binding.

**Integration tests** alongside `process-bids.test.ts`: an over-cap week awards
and drops correctly, `team_drops` gains exactly one row per executed
conditional drop, `drop_limit` is respected, and a losing bid with a conditional
drop leaves the roster untouched.

**Endpoint tests** for `set-bid-priorities` mirroring
`set-counterpick-bid-priorities.test.ts`, including the 403 path for reordering
another team's bids.

Per CLAUDE.md the full Deno suite runs after the code-simplifier pass, then
browser verification: log in as `alice@fantasyreel.test`, fill a roster, place
an over-cap bid with a conditional drop, reorder priorities, confirm no console
errors.

Note from prior sessions: `process-bids-dropped-targets.test.ts` fails on `main`
already. It is not a regression from this branch.

## Deployment notes

1. Apply the migration (`npx supabase migration up` — not `db reset`).
2. Add the `[functions.set-bid-priorities]` block with `verify_jwt = false` to
   `config.toml` **before** deploying, or the endpoint 401s in production.
3. Deploy `place-bid`, `process-bids`, `set-bid-priorities`.

Merges to `main` auto-deploy migrations and functions, so steps 1 and 3 happen
on merge; step 2 must be in the same commit.

Ordering is safe in either direction: the backfilled `priority` reproduces the
old implicit ordering, so a new `process-bids` against un-backfilled rows and an
old `process-bids` against backfilled rows both behave as they do today.

## Deliberately not doing

- **Blocking a bid that has no room and no conditional drop.** A slot can free
  up before processing; refusing the bid a week early forecloses that.
- **Reserving drop allowance at bid time.** Costs refund-reconciliation on every
  cancel and loss, and the resolver already handles over-commitment in priority
  order.
- **A combined pickup + counterpick priority list.** Different capacity pools;
  ranking across them means nothing.
- **A uniqueness constraint on `priority`.** Same reasoning as counterpicks:
  reordering would need a transaction purely to avoid transient collisions.
- **Making `execute_trade` aware of conditional drops.** A trade that moves a
  drop target away simply invalidates it, and the fallback above covers that.
