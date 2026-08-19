# Plan: Per-offer trade expiry ("this offer is good for 48 hours")

## Context

League members already do this by hand in Discord — "you've got till Friday or I'm
pulling it" — because nothing in the app makes an offer go stale. Today a trade
offer sits in `proposed`/`countered` forever: the only exits are the recipient
responding, the proposer cancelling, a competing trade invalidating it
(`execute_trade`), or the season-level league trade deadline blocking the accept.
The result is a trading page that accumulates zombie offers whose terms nobody
still means.

This plan adds an **offer-level expiry**: the proposer picks how long the offer
stands, the clock is visible to both sides in-app and in Discord, and the offer
auto-expires when it runs out.

### Naming: two different "deadlines" already exist

Do not overload the word. There are now three clocks on a trade, and the code
must keep them apart:

| Clock | Where | Meaning |
|---|---|---|
| League trade deadline | `leagues.trade_deadline` (DATE, `20260128_create_trading_system.sql:113`) | Season-level: last date a trade may happen at all. Enforced in `validateLeagueTradingEnabled` (`_shared/trade-validation.ts:329`). |
| Review / veto window | `trade_offers.review_ends_at`, `leagues.trade_veto_hours` | Post-accept commissioner window. Owned by `respond_to_trade` (`20260132_trading_race_condition_fixes.sql:212`). |
| **Offer expiry (new)** | `trade_offers.expires_at` | How long *this offer* stands before it lapses unanswered. |

In code, the new thing is **`expires_at` / "offer expiry"**, never "deadline".
In UI copy: "Offer expires in 6h" vs "League trade deadline: Nov 30".

### What already helps us

- `trade_status` already has an `'expired'` value, described in the enum as
  "Trade deadline passed" — currently used by `process-trades` for offers that
  stop validating, and by `execute_trade` for competing offers superseded by a
  completed trade.
- `process-trades` already runs every 5 minutes via Vercel Cron
  (`vercel.json` → `/api/cron/process-trades`) with `startJobRun` observability.
- `useTrading` subscribes to **all** `trade_offers` changes for the league
  (`useTrading.ts:114`), so a cron-driven status flip reaches an open trading
  page live with no extra work.
- `TradeOfferCard` already renders one countdown (`TradeOfferCard.tsx:281`, the
  review window) — the visual pattern exists.

---

## Product decisions (recommended defaults, all open to override)

1. **Per-offer, chosen by the proposer.** That is what people already type in
   Discord. A league-wide fixed window is simpler but doesn't model the actual
   behavior ("this one is time-sensitive, that one isn't").
2. **"No expiry" stays first-class.** Some leagues will hate timers. Null
   `expires_at` = current behavior, and every existing offer backfills to null.
3. **Default 48h**, preset chips 24h / 48h / 3d / 7d / No expiry.
4. **Bounds: min 1h, max 14 days.** The minimum matters — a 5-minute offer is a
   pressure tactic, not a deadline.
5. **Clamp to the league trade deadline.** An offer that outlives the season
   deadline can never be accepted (`validateTradeProposal` re-checks the league
   deadline on accept), so it should lapse at the deadline instead of dying with
   a confusing error later.
6. **A counter-offer resets the clock**, with the counterer choosing the new
   window. See the hazard section — this is the sharpest bug in the feature.
7. **Expiry is not cancellation.** Distinct terminal state, distinct copy,
   distinct notification. History should show "lapsed" ≠ "pulled".
8. **The proposer may extend, never shorten.** Shortening lets someone yank the
   rug while the recipient is mid-decision.

---

## Data model

One migration, `<ts>_trade_offer_expiry.sql`:

```sql
ALTER TABLE trade_offers
  ADD COLUMN expires_at              TIMESTAMPTZ,
  ADD COLUMN expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN expired_reason          TEXT
    CHECK (expired_reason IS NULL
           OR expired_reason IN ('offer_deadline', 'league_deadline'));

-- Sweep support. Predicate is a strict subset of the existing "open" list, so
-- it does not redefine open-ness (see the four-places hazard below).
CREATE INDEX idx_trade_offers_pending_expiry
  ON trade_offers (expires_at)
  WHERE status IN ('proposed', 'countered') AND expires_at IS NOT NULL;
```

`TIMESTAMPTZ`, not `DATE`. `leagues.trade_deadline` is a DATE compared against
server-local `setHours(23,59,59)` in `_shared/trade-validation.ts:331-335` — a
pre-existing timezone wart we should not reproduce.

**`expired_reason` is deliberately narrow.** `execute_trade` and `process-trades`
already write `status='expired'` with an explanatory `veto_reason`; they are left
untouched. The UI rule becomes: `expired_reason === 'offer_deadline'` → "The
offer window closed"; `'league_deadline'` → "The league trade deadline passed";
otherwise fall back to the existing `veto_reason` text. This avoids rewriting
`execute_trade`, which every migration that touches it must copy forward verbatim.

Phase 3 adds league config: `leagues.trade_offer_expiry_default_hours`,
`..._min_hours`, `..._max_hours`.

---

## Enforcement: two layers, and why both are needed

**Layer 1 — authoritative, lazy, under the row lock.** `respond_to_trade()` and
`counter_trade()` (`20260132_trading_race_condition_fixes.sql:212` and `:301`)
already lock the row via `get_trade_offer_for_update`. Add there, immediately
after the existing status check:

```sql
IF v_trade.expires_at IS NOT NULL AND v_trade.expires_at <= now() THEN
  RETURN jsonb_build_object('error', 'This offer has expired', 'status_code', 400);
END IF;
```

This is what actually protects the data. A cron that is late, wedged, or
mid-batch can never let a stale offer be accepted.

**Layer 2 — the materializing sweep**, so the row's status, the notifications,
and the UI reflect reality. Folded into the existing `process-trades` cron as a
separate step before the execution loop:

```sql
UPDATE trade_offers
SET status = 'expired', expired_reason = 'offer_deadline', updated_at = now()
WHERE status IN ('proposed', 'countered')
  AND expires_at IS NOT NULL
  AND expires_at <= now()
RETURNING *;
```

Three properties worth stating, because each is a bug if lost:

- **Atomic claim.** The same statement filters and flips, so two overlapping cron
  runs cannot both claim a row and double-notify. Notify only the rows
  `RETURNING` hands back.
- **`now()` is the database's**, not the function's. `process-trades:68` builds
  `now` in JS and interpolates it into the filter; the sweep must not copy that —
  every other clock in the trade system (`review_ends_at`, `accepted_at`) is DB
  time, and mixing sources invites off-by-a-clock-skew disputes.
- **Not subject to `.limit(10)`.** That cap at `process-trades:83` bounds
  *executions*, which are expensive. Expiry is one UPDATE; a league that has let
  40 offers pile up should not need 20 minutes to clear them. Cap the
  notification fan-out instead if anything.

The same sweep step handles the league-deadline case: open offers in leagues
whose `trade_deadline` has passed → `expired_reason='league_deadline'`.

**Layer 3 (UX only)** — mirror the expiry check in the TypeScript edge functions
`respond-trade` and `counter-trade` before the RPC, for a cleaner error. Same
"UX-earlier mirror of the authoritative SQL guard" pattern already documented on
`validateMovieOwnership` in `_shared/trade-validation.ts`.

---

## Integration hazards

These are the things that will actually break. Ordered by how easy they are to
miss.

1. **`counter_trade()` updates the row in place.** The counter flow swaps
   `initiator_team_id`/`recipient_team_id` on the *same* `trade_offers` row (see
   the ROLE SWAP comment at `counter-trade/index.ts:74-79`). If the migration
   does not set a fresh `expires_at`, a counter silently inherits the original
   proposer's clock — so someone counters a 48h offer at hour 47 and it lapses a
   minute later. `counter_trade()` must take `p_expires_at` and overwrite.
   Likewise `expiry_reminder_sent_at` must be reset to NULL on counter.

2. **The four-places open-status rule.** `20260809120000_allow_competing_trades.sql`
   hardcodes `status IN ('proposed','countered','review','accepted')` in
   `get_contested_source_ids` (`:84`), inside `execute_trade` (`:135`), and in two
   partial indexes (`:432`, `:436`) — with an explicit comment that a helper
   function would defeat the planner's use of the partial indexes and that all
   four must change together. **Do not add `expires_at` to that status list.**
   The consequence is a time-expired-but-not-yet-swept offer still counting toward
   the "Contested" badge for up to 5 minutes. Recommendation: accept that
   staleness in v1 (it is a badge, and the sweep is frequent). If it ever matters,
   add `AND (expires_at IS NULL OR expires_at > now())` to `get_contested_source_ids`
   **only**, with a comment marking the deliberate divergence — the extra
   predicate filters on top of the index, it does not disqualify it.

3. **New enum value cost.** There is no `trade_expired` notification type; the
   existing expiry path reuses `'trade_cancelled'` with a "Trade Expired" title
   (`process-trades/index.ts` → `notifyTradeExpired`). Adding a value to
   `notification_type` cannot be used in the same migration transaction that adds
   it, so it costs two migrations. **Reuse `trade_cancelled`** and keep the copy
   in the title/body, matching what the codebase already does.

4. **`review` and `accepted` are immune.** Once both parties agree, the review
   clock owns the trade. The sweep's status filter must be exactly
   `('proposed','countered')`. Keep `expires_at` on the row for audit but stop
   displaying it after accept.

5. **Realtime already works — verify, don't rebuild.** `useTrading.ts:114`
   subscribes to `event: '*'` on `trade_offers` filtered by league, so a sweep
   UPDATE reaches open pages. The card just needs to render the new status.

6. **Backfill.** Every existing open offer gets `expires_at = NULL` and never
   expires. Do not retro-apply a default window to live offers — people did not
   agree to a clock they never saw.

---

## UX

### Proposing (`ProposeTradeModal.tsx`)

A chip row directly above the existing optional Message field (`:352`):

```
Offer expires:  [ 24h ] [ 48h ] [ 3 days ] [ 7 days ] [ No expiry ]
```

Selected chip uses gold border/text (`.btn-secondary` idiom); resolved absolute
time shown underneath in `text-foreground-muted` ("Expires Fri, Aug 22 at 4:15 PM")
so nobody has to do timezone math. When the league trade deadline would clamp the
choice, show that inline rather than silently truncating.

### On the card (`TradeOfferCard.tsx`)

A countdown pill beside the existing status badge, mirroring the review countdown
at `:281`, with urgency tiers:

| Remaining | Treatment |
|---|---|
| > 24h | `text-foreground-muted` — "Expires in 2 days" |
| 2–24h | `bg-warning-bg text-warning` |
| < 2h | `bg-error-bg text-error` |
| < 2h **and you are the recipient** | add `animate-glow-pulse` |

That last row is a design-system call worth making explicitly:
`animate-glow-pulse` is currently reserved for "your turn" states, and an offer
about to lapse on your desk *is* one. If we'd rather keep the animation unique to
the draft, drop it and keep the crimson pill.

Use `<time dateTime={expires_at}>` with `formatRelativeDate` (already imported at
`:15`) so hover gives the absolute time. `formatRelativeDate` is static — only
mount a live-ticking interval when remaining < 1h, and only for open offers, to
avoid a page of cards re-rendering every second.

### Expired state

Expired offers stay in history, greyed, with reason-specific copy:
- `offer_deadline` → "Expired — the offer window closed"
- `league_deadline` → "Expired — the league trade deadline passed"
- else → existing `veto_reason` text (competing trade, failed revalidation)

This also fixes a current papercut: time-lapse and competing-offer invalidation
render identically today.

### Extending

Proposer-only action on their own open offer: "Extend +24h", forward-only. This
matters because the alternative — cancel and re-propose — destroys the thread,
re-notifies everyone, and re-enters the contested pool. New edge function
`extend-trade-offer`, which per the project's deployment rule needs a
`config.toml` entry with `verify_jwt = false`.

### Racing the clock

The recipient hits Accept a second after the offer lapses and gets a 400. The
error must not surface as a raw toast: `useTrading.respondTrade` should refetch on
that specific failure so the card visibly flips to Expired. Same handling for
`AcceptConfirmModal` — close it and show the expired card underneath.

---

## Notifications

| Event | In-app | Email | Discord |
|---|---|---|---|
| Offer proposed / countered | existing | existing | **add "Expires" field** |
| Expiring soon (one nudge) | `trade_cancelled` type, "expires in 6 hours" | new `expiring_soon` type | optional, ping recipient |
| Expired | `trade_cancelled` type, both parties | new `expired` type | post to `trades` category |

**Discord is the highest-value integration here**, since this behavior started in
Discord. Add the expiry to the embed fields in `propose-trade/index.ts` and
`counter-trade/index.ts` using a Discord relative timestamp:

```ts
{ name: 'Expires', value: `<t:${Math.floor(new Date(expiresAt).getTime()/1000)}:R>`, inline: true }
```

Discord renders that as a live "in 2 days" in every member's own timezone — which
is exactly what people are currently typing by hand.

**Reminder idempotency.** One nudge per offer at `min(6h, 25% of the window)`
remaining, skipped entirely for windows under 2h. Claim it the same way as the
sweep — `UPDATE ... SET expiry_reminder_sent_at = now() WHERE expiry_reminder_sent_at
IS NULL AND ... RETURNING *` — so a cron overlap cannot double-send. Reset to NULL
on counter.

Email additions go through the existing `TradeEmailType` union in
`_shared/email.ts:320` and must be logged via `logNotificationDelivery` with
stable snake_case types: `trade_offer_expiring`, `trade_offer_expired`.

---

## Observability

- `process-trades` job_runs metadata gains `expired_by_deadline` and
  `expiry_reminders_sent` alongside the existing `completed` / `invalidated`.
- Sweep failures push to `results.errors` so a non-ok `job_status` fires the
  existing `alertOps` path — no new manual alert calls.
- Analytics (`utils/analytics.ts`, ids only): `trade_offer_expiry_set` (with the
  chosen bucket), `trade_offer_extended`, `trade_offer_expired`. Register the
  names in that file's canonical list rather than inventing variants at call sites.
- The metric that answers "did this work": response rate and median
  time-to-response on offers with an expiry vs. without.

---

## QA plan

### Deno tests (`supabase/functions/tests/`)

New `trade-expiry.test.ts`, plus additions to existing files:

- `propose-trade`: expiry in the past → 400; below min / above max → 400; beyond
  the league trade deadline → clamped, not rejected; omitted → null and the offer
  never expires.
- `respond-trade`: accept an offer whose `expires_at` has passed but which the
  cron has **not** yet swept → 400 (this is the layer-1 guard, and the single most
  important test in the feature); accept at `expires_at - 1s` → succeeds.
- `counter-trade`: counter resets `expires_at` to the counterer's window and
  clears `expiry_reminder_sent_at`; countering an already-lapsed offer → 400.
- `process-trades`: sweep flips only `proposed`/`countered`; leaves `review` and
  `accepted` alone; leaves `expires_at IS NULL` alone; notifies both parties
  exactly once; a second run over the same data notifies zero times.
- `extend-trade-offer`: proposer can extend forward; recipient cannot extend;
  nobody can shorten; cannot extend a non-open offer.
- Race, following the `competing-trades.test.ts` pattern: interleave a sweep and
  an accept against the same row and assert exactly one wins and the loser gets a
  coherent error.

### E2E (Playwright)

Propose with a short window as Alice → Bob sees the countdown pill → force
`expires_at` back in the DB and run the cron route → Bob's open page flips to
Expired via realtime without a reload. Use `data-testid` on the countdown pill —
per the repo's E2E notes, not a CSS/nav selector.

### Manual checklist

- Timezone: propose from a UTC-negative offset, confirm the absolute time
  matches in-app, in email, and in the Discord embed.
- An offer expiring while the recipient sits in `AcceptConfirmModal`.
- Discord `<t:...:R>` renders as a live countdown, not a raw number.
- A league with `trade_deadline` set: offers clamp, and the deadline sweep fires.
- Mobile: the countdown pill and status badge must not wrap into the movie list.

### Migration verification

Run `npx supabase migration up` (**not** `db reset`) against a DB carrying live
open offers; assert every pre-existing offer has `expires_at IS NULL` and that a
sweep leaves all of them untouched.

---

## Phasing

**Phase 1 — the feature.** Migration; `respond_to_trade` / `counter_trade` guards;
sweep in `process-trades`; expiry picker in `ProposeTradeModal`; countdown +
expired-reason copy in `TradeOfferCard`; expiry field in the Discord embeds;
expired notifications. Shippable and complete on its own.

**Phase 2 — nudges.** Expiring-soon reminder (email + in-app + optional Discord),
`extend-trade-offer` edge function and its button.

**Phase 3 — league configuration.** `trade_offer_expiry_default_hours` / min / max
on `leagues`. Note the true cost: there is **no trade section in the league
settings UI at all** today — `update-league/index.ts` handles info, draft,
bidding, and counterpick config only, so this phase means a new
`TradeConfigSection.tsx`, a new `handleUpdateTradeConfig` branch, and matching
`/league-options` output in the Discord bot (which currently displays
`trade_deadline`, `trade_veto_hours`, `trade_review_enabled` read-only at
`apps/discord-bot/src/commands/league-options.ts:79`).

Suggested agent team for Phase 1, per the topography table in CLAUDE.md:
**Full-Stack Feature** — lead + backend-dev (migration + `process-trades` sweep +
edge-function guards) + frontend-dev (modal picker, card countdown, `useTrading`
race handling) + reviewer. Handoff contracts: `trade_offers.expires_at`
(timestamptz, nullable), `expired_reason` (text, checked), `propose-trade` body
gains `expires_at?: string | null`, `counter-trade` body gains the same.

---

## Open questions

1. Default window — 48h, or no expiry unless the proposer opts in?
2. Should a commissioner be able to *require* an expiry on every offer (and set a
   minimum), or is this purely per-proposer?
3. Should the league trade deadline auto-expire open offers, or leave them to die
   at accept time as they do now? (This plan assumes auto-expire.)
4. Is `animate-glow-pulse` allowed outside draft "your turn" states?
5. Does an expired offer stay visible in the trading feed indefinitely, or fold
   into a collapsed history section after some period?
