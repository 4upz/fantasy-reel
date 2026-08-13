# New-Bid Cutoff: Splitting the Bidding Week Into Open and Counter-Bid Phases

**Date:** 2026-08-12
**Status:** Approved for implementation

## Problem

The pickup bidding week runs Saturday 8pm UTC to Saturday 8pm UTC, with every
bid stamped with the same weekly `processing_deadline` from
`get_next_processing_deadline()`. A team can open a bid on a brand-new movie at
any point in that week, including minutes before processing. Teams that bid
early are exposed to a late ambush they have no time to answer, and the
counter-bid mechanic (`counterbid_hours`, default 24) only helps a team that has
already been outbid on a movie it was already contesting.

We want the back half of the week to be about resolving contests that already
exist, not opening new ones.

## Solution

Split the week at a **new-bid cutoff** placed a configurable number of hours
before the weekly processing deadline. Default 48 hours, which puts it at
**Thursday 8pm UTC**.

Before the cutoff — the **open phase** — bidding behaves exactly as it does
today. After the cutoff — the **counter-bid phase** — two restrictions apply,
both taken from Fantasy Critic's public-bidding window:

1. **No opening a bid on a movie nobody is bidding on.** A movie with no pending
   bids in the league is off the table until the next cycle.
2. **No cancelling a bid.** Once the counter-bid phase starts, a bid is a
   commitment.

Everything else stays legal in the counter-bid phase: joining a contest another
team started, countering after being outbid, and raising your own leading bid.

### Why these two rules together

Rule 1 without rule 2 leaves the bait-and-withdraw exploit open: bid early on a
movie you don't want, let a rival raise the price, then cancel on Friday and
walk away having cost them budget for nothing. Rule 2 closes it. Fantasy Critic
pairs the same two restrictions for the same reason.

### Phase boundary is derived, never stored

`get_new_bid_cutoff(league_id)` returns
`get_next_processing_deadline() - new_bid_cutoff_hours`, evaluated at call time.
Because `get_next_processing_deadline()` is monotone within a cycle and rolls
forward the instant a cycle ends, deriving from "now" is always correct:

| Now | Next deadline | Cutoff | Phase |
|---|---|---|---|
| Wed | Sat 8pm | Thu 8pm (future) | open |
| Fri | Sat 8pm | Thu 8pm (past) | counter-bid |
| Sat 9pm (post-processing) | *next* Sat 8pm | *next* Thu 8pm (future) | open |

No column stores the phase, nothing has to be migrated forward each week, and a
league that changes `new_bid_cutoff_hours` mid-season takes effect immediately.

## Configuration

`leagues.new_bid_cutoff_hours INTEGER NOT NULL DEFAULT 48`, constrained to
`0..144`.

- **48** (default) — Thursday 8pm UTC.
- **0** — cutoff disabled; the league keeps today's behavior. This is the escape
  hatch for leagues that don't want the rule.
- **144** max leaves at least 24 hours of open bidding, so the window can never
  be configured shut.

Editable in the existing `BiddingConfigSection` on the league settings page and
in `CreateLeagueModal`, alongside `counterbid_hours`. Like the other bidding
config, it is locked once the draft starts.

## Scope

The cutoff applies to **both** pickup bids (`place-bid`, `cancel-bid`) and
counterpick bids (`place-counterpick-bid`, `cancel-counterpick-bid`). They share
`get_next_processing_deadline()`, the same weekly cycle, and the same UI panel;
splitting the rule between them would give one page two deadlines.

## Components

### 1. Migration — `20260812…_new_bid_cutoff.sql`

- `leagues.new_bid_cutoff_hours` column + bounds constraint + comment.
- `get_new_bid_cutoff(p_league_id UUID) RETURNS TIMESTAMPTZ` — returns `NULL`
  when the league is missing or the cutoff is disabled. Left `VOLATILE` (the
  default) to match `get_next_processing_deadline()`, which is itself
  undeclared: marking it `STABLE` while it calls a `VOLATILE` function would be
  a lie the planner is entitled to act on. `REVOKE`d from `PUBLIC` and granted
  to `authenticated`, `service_role` — a grant on its own restricts nothing.
- `bid_cutoff_announcements` table for Discord idempotency (below).

### 2. `_shared/bid-window.ts` — the phase, as a pure function

```ts
export interface BidWindow {
  processingDeadline: Date
  cutoffAt: Date | null        // null when disabled
  isCounterBidPhase: boolean   // cutoffAt !== null && cutoffAt <= now
}

export function computeBidWindow(
  processingDeadline: string | Date,
  cutoffHours: number | null | undefined,
  now?: Date,
): BidWindow
```

Pure, so the phase arithmetic is unit-testable without a database, and shared so
`place-bid`, `place-counterpick-bid`, both cancel functions, and the
announcement job cannot drift on where the boundary sits. The user-facing
refusal strings live here too, for the same reason.

### 3. Edge Function changes

**`place-bid`** — the movie's pending bids are already fetched to find the
leader; widen that query from `status = 'active'` to `('active','outbid')` so the
same round trip answers "is anyone bidding on this movie at all". Then:

```
if (window.isCounterBidPhase && pendingBids.length === 0) → 400
```

A movie whose only bids were cancelled counts as uncontested, which is correct:
re-opening it after the cutoff is exactly what rule 1 forbids.

**`place-counterpick-bid`** — the same check against `counterpick_bids`.

**`cancel-bid` / `cancel-counterpick-bid`** — refuse when
`window.isCounterBidPhase`, and *also* when the bid's own
`processing_deadline` has already passed.

Both anchor the window to the bid's **own** `processing_deadline` rather than to
a freshly computed `get_next_processing_deadline()`, so the question asked is
"is this bid's cycle past its cutoff" — which stays true for a bid held into
extended time by a rival's counter window, where the global next-deadline has
already rolled forward and would otherwise read as a fresh open phase.

The second condition is not redundant with the first: it is the only guard for a
league that has the cutoff disabled (`hours = 0`), where a bid awaiting the
hourly `process-bids` run could otherwise be withdrawn out from under it —
the bait-and-withdraw hole at exactly the moment it pays best.

### 4. Frontend

`bidding/page.tsx` calls `get_new_bid_cutoff` and passes the timestamp down, so
the client never re-derives "next Saturday 8pm" in TypeScript and cannot drift
from the SQL.

- **`BidWeekTimeline`** (new) — the week as a single bar in the header card,
  notched where new bids stop: a gold fill for time elapsed, a gap punched
  through at the cutoff, and a label under each half. The feature *is* a week
  cut in two, so the bar shows the cut rather than describing it, and which half
  you are standing in reads without parsing a sentence. Renders nothing when the
  league has no cutoff — there is no split to draw.
- **`PlaceBidModal`** — in the counter-bid phase the TMDb search is replaced by
  the list of movies already in play. Searching a global catalogue you're not
  allowed to bid from is a dead end; showing the contested set is the actual
  choice available. The CTA becomes "Counter a Bid", and is disabled with an
  empty-state explanation when nothing is in play.
- **`BidCard` / `CounterpickBidCard`** — the cancel button is replaced by a
  "Locked in" note in the counter-bid phase, rather than offering an action the
  server will refuse.
- **`useDraftMovies`** — gains an `enabled` flag. Without it the bid modal fires
  a TMDb browse request in the counter-bid phase whose results it never shows.

### 5. Discord: the cutoff announcement

One embed per league, sent when the league crosses its cutoff, carrying all
three things the commissioner asked for:

- **Headline** — the new-bid deadline has been reached; the counter-bid phase is
  open.
- **Pending-bid summary** — every movie with a live bid this week, its current
  high bid, and how many teams are on it. Pickup and counterpick bids in one
  list, capped at Discord's field limit.
- **Close reminder** — when bids process, as a `<t:…>` timestamp so each member
  reads it in their own timezone. This goes in a field, not the footer, because
  Discord does not render timestamp markup in footers.

**Scheduling.** Because `new_bid_cutoff_hours` is configurable, a fixed
Thursday-8pm cron would only be correct for leagues left at 48. The job runs
**hourly** instead and announces the leagues whose cutoff has just passed. Both
the deadline and the offset are whole hours, so every league's cutoff lands
exactly on an hour boundary the job visits.

**Idempotency.** `bid_cutoff_announcements (league_id, processing_deadline)`
with a unique index, written before dispatch — same shape as
`discord_notification_log`, but keyed on the cycle rather than on a movie, since
this announcement is per-cycle. A rerun within the same cycle is a no-op; the
next cycle has a new `processing_deadline` and announces again.

## Testing

| Area | Coverage |
|---|---|
| `bid-window.test.ts` | cutoff arithmetic, disabled (0), exact-boundary instant, missing config |
| `tests/bid-cutoff.test.ts` | opening bid refused after cutoff; joining a contested movie allowed; raising own bid allowed; a movie whose only bid was cancelled counts as uncontested again; cancels refused after cutoff and once `processing_deadline` passed; everything allowed when disabled |
| `_shared/bid-cutoff-announcement.test.ts` | embed contents, pickup + counterpick merged, no-bids case, idempotent rerun, cutoff-disabled leagues skipped, non-default offsets, field cap |
| `tests/update-league.test.ts` | bounds validation on the new field, including 0 and fractional input |

`tests/bid-cutoff.test.ts` cannot pin the clock — `place-bid` computes the
deadline live — so it widens `new_bid_cutoff_hours` until the cutoff falls
behind the current moment. The column caps at 144, so the closed-window steps
skip during the first ~24 hours of a cycle (Saturday 8pm to Sunday 8pm UTC),
where no allowed offset reaches back far enough. The boundary arithmetic is
covered exhaustively and deterministically by the pure unit tests instead; these
only prove the Edge Functions are asking.

`_mock-client.ts` gains `rpc()` support and optional unique-constraint
enforcement (Postgres error `23505`), so the announcement's idempotency guard is
tested through the insert actually failing rather than only the happy path.

## Deployment notes

Per `CLAUDE.md`, each new Edge Function needs a `config.toml` entry with
`verify_jwt = false` or it 401s in production. The announcement job also needs
its `vercel.json` cron entry and an `/api/cron/…` route.

## Deliberately not doing

- **No change to how `process-bids` resolves anything.** The cutoff governs what
  may be *placed*, not what happens at resolution.
- **No grandfathering.** Existing leagues get the 48-hour default on migration.
  That is the requested rule; `0` is there for anyone who wants out.
- **No special case for leagues activated mid-week.** A league that goes active
  on a Friday has its first cutoff already behind it and opens no new bids until
  Saturday's roll-over. It self-corrects within 48 hours, and special-casing the
  first cycle would add a rule that only ever fires once.
