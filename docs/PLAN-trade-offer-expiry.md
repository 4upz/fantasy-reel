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
3. **Default 48h**, preset chips 24h / 48h / 3d / 7d / **When _X_ releases** /
   **Custom…** / No expiry.
4. **Bounds: min 1h, max 14 days**, enforced on the server, not just in the
   picker. The minimum matters — a 5-minute offer is a pressure tactic, not a
   deadline — and a custom picker is exactly where someone will try to set one.
5. **A release-anchored preset**, expiring at the first release among the movies
   in the offer. This is the one preset that encodes fantasy logic rather than
   clock convenience: the deal is only a bet while the movie is still unreleased.
6. **Clamp to the league trade deadline.** An offer that outlives the season
   deadline can never be accepted (`validateTradeProposal` re-checks the league
   deadline on accept), so it should lapse at the deadline instead of dying with
   a confusing error later.
7. **A counter-offer resets the clock**, with the counterer choosing the new
   window. See the hazard section — this is the sharpest bug in the feature.
8. **Expiry is not cancellation.** Distinct terminal state, distinct copy,
   distinct notification. History should show "lapsed" ≠ "pulled".
9. **The proposer may extend, never shorten.** Shortening lets someone yank the
   rug while the recipient is mid-decision.

---

## Data model

One migration, `<ts>_trade_offer_expiry.sql`:

```sql
ALTER TABLE trade_offers
  ADD COLUMN expires_at              TIMESTAMPTZ,
  ADD COLUMN expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN expiry_anchor           TEXT
    CHECK (expiry_anchor IS NULL OR expiry_anchor IN ('fixed', 'first_release')),
  ADD COLUMN expired_reason          TEXT
    CHECK (expired_reason IS NULL
           OR expired_reason IN ('offer_window', 'movie_released', 'league_deadline')),
  -- An offer either has a clock and a record of where it came from, or neither.
  ADD CONSTRAINT check_expiry_anchor_paired
    CHECK ((expires_at IS NULL) = (expiry_anchor IS NULL));

-- Sweep support. Predicate is a strict subset of the existing "open" list, so
-- it does not redefine open-ness (see the four-places hazard below).
CREATE INDEX idx_trade_offers_pending_expiry
  ON trade_offers (expires_at)
  WHERE status IN ('proposed', 'countered') AND expires_at IS NOT NULL;
```

**`expires_at` is always a resolved timestamp**, whatever the user picked.
Presets, the custom picker, and the release anchor all collapse into one column,
so the sweep, the index, the countdown, and every guard stay uniform with exactly
one thing to compare. `expiry_anchor` exists to record *how* that timestamp was
derived, which matters for one thing: a `first_release` offer has to be
re-resolved when the movie moves. See "The release anchor" below.

Note the deliberate absence of a "which movie anchored this" column. The enriched
items JSONB already carries `movie_id`, `title`, and `release_date` per movie
(`enrichTradeItems`, `_shared/trade-validation.ts:622-661`), so both the chip
label and the re-resolution can be computed from the row itself.

`TIMESTAMPTZ`, not `DATE`. `leagues.trade_deadline` is a DATE compared against
server-local `setHours(23,59,59)` in `_shared/trade-validation.ts:331-335` — a
pre-existing timezone wart we should not reproduce.

**`expired_reason` is deliberately narrow.** `execute_trade` and `process-trades`
already write `status='expired'` with an explanatory `veto_reason`; they are left
untouched. The UI rule becomes: `expired_reason` drives the copy —
`'offer_window'` → "The offer window closed", `'movie_released'` → "_X_ released",
`'league_deadline'` → "The league trade deadline passed" — and anything else falls
back to the existing `veto_reason` text. This avoids rewriting
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
SET status = 'expired', expired_reason = 'offer_window', updated_at = now()
WHERE status IN ('proposed', 'countered')
  AND expires_at IS NOT NULL
  AND expires_at <= now()
RETURNING *;
```

Three properties worth stating, because each is a bug if lost:

- **Atomic claim.** The same statement filters and flips, so two overlapping cron
  runs cannot both claim a row and double-notify. Notify only the rows
  `RETURNING` hands back.
- **`now()` is the database's**, not the function's. `process-trades/index.ts:68` builds
  `now` in JS and interpolates it into the filter; the sweep must not copy that —
  every other clock in the trade system (`review_ends_at`, `accepted_at`) is DB
  time, and mixing sources invites off-by-a-clock-skew disputes.
- **Not subject to `.limit(10)`.** That cap at `process-trades:83` bounds
  *executions*, which are expensive. Expiry is one UPDATE; a league that has let
  40 offers pile up should not need 20 minutes to clear them. Cap the
  notification fan-out instead if anything.

The same cron step handles two more cases:

- **League deadline.** Open offers in leagues whose `trade_deadline` has passed →
  `expired_reason='league_deadline'`.
- **Release re-resolution.** Before the expiry claim runs, recompute `expires_at`
  for open `expiry_anchor='first_release'` offers from live `movies.release_date`
  (see "The release anchor"). Order matters: re-resolve first, then sweep, so a
  movie that moved earlier expires in the same run instead of the next one. An
  offer whose anchor has passed gets `expired_reason='movie_released'`.

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

7. **The items JSONB `release_date` is a snapshot, not a source of truth.**
   `enrichTradeItems` copies `title`, `poster_url`, and `release_date` into the
   offer at proposal time (`_shared/trade-validation.ts:655-660`). Every other
   consumer treats that as display data, so it has never mattered that it drifts.
   Release-anchored expiry is the first thing that would make a decision on it.
   Resolve through `movie_id` → `movies.release_date` instead, both at proposal
   time and on every re-resolution.

8. **Client-side minimum enforcement is theater on its own.** The custom picker
   makes it trivial to submit any timestamp — an edited `min` attribute, a direct
   `callEdgeFunction` call, or the Discord bot later. `propose-trade`,
   `counter-trade`, and `extend-trade-offer` must each range-check `expires_at`
   server-side; the picker's job is to make the valid range obvious, not to
   guarantee it.

---

## UX

### Proposing (`ProposeTradeModal.tsx`)

A chip row directly above the existing optional Message field (`:352`):

```
Offer expires:  [ 24h ] [ 48h ] [ 3 days ] [ 7 days ]
                [ When Dune 3 releases ] [ Custom… ] [ No expiry ]
```

Selected chip uses gold border/text (`.btn-secondary` idiom); the resolved
absolute time always appears underneath in `text-foreground-muted` ("Expires Fri,
Aug 22 at 4:15 PM — in 2 days") so nobody has to do timezone math, and so the two
derived options (release anchor, custom) show their answer the same way the simple
presets do. When the league trade deadline would clamp the choice, say so inline
rather than silently truncating.

### The custom picker

Choosing "Custom…" reveals a datetime field inline, below the chip row.

**This is the app's first date/time input.** A repo-wide grep for `type="date"`
and `type="datetime-local"` returns nothing; `BiddingConfigSection.tsx` and
`DraftConfigSection.tsx` use only number and text inputs, and there is no
date-picker dependency in `apps/frontend/package.json`. Per the project's
"check existing components before creating new patterns" rule, this should land as
a shared `app/components/DateTimeField.tsx`, not inline in the trade modal —
league draft windows and bidding windows are the obvious next callers.

Recommended: **native `<input type="datetime-local">`** styled with the existing
`.input` class. It gets the native wheel picker on iOS/Android for free, adds no
bundle weight, and is keyboard-accessible by default. Its cost is cosmetic
inconsistency across browsers, which is an acceptable trade for a field used once
per trade proposal.

Minimum enforcement happens in **three places, and all three are needed**:

1. **`min` / `max` attributes** on the input (`now + 1h`, `now + 14d`), so the
   native picker greys out invalid times. Convenience only — these are trivially
   editable in devtools and are not honored uniformly.
2. **A JS guard** that disables the submit button and renders an inline message in
   the `.alert-error` idiom: "An offer has to stay open at least 1 hour." Re-check
   on submit, not just on change, because the clock keeps moving while the modal
   is open — a picker opened at 5:00 with a 6:00 selection is invalid by 5:01.
3. **The authoritative check in `propose-trade` / `counter-trade`.** A crafted
   request bypasses everything above. 400 with the same wording as the inline
   message so the two never contradict each other.

Details worth getting right: convert the field's local wall-clock value with
`new Date(value).toISOString()` and store UTC; round seconds off so the countdown
doesn't show "in 59 minutes" for a value the user set to exactly one hour; keep a
visible resolved preview because `datetime-local` gives no timezone affordance at
all. For accessibility, associate the hint and the error with `aria-describedby`,
give the error `role="alert"`, and mark invalid state with more than color.

### The release anchor

"When _X_ releases" resolves to the **earliest release date among all movies in
the offer, both sides**. Earliest rather than latest: once any movie in the deal is
out, the deal's information balance has already changed, so that is the moment the
offer should stop standing.

**Boundary convention.** The codebase already has exactly one definition of
"released": `isUpcomingMovie()` (`_shared/utils.ts:137-156`) treats a movie as
upcoming while `release_date >= today` (UTC date-string compare), so it flips to
released at the start of the day *after* its release date. The anchor should use
that same boundary — `release_date + 1 day` at 00:00 UTC — rather than inventing a
third date rule, which is a hazard the bidding-release plan called out explicitly.
The tighter alternative (expire at the *start* of the release day) is in the open
questions below; it reads better against the chip label and closes a small
information-asymmetry window, at the cost of a second definition of released.

**The chip is conditional and live.** Its label and validity depend on the current
movie selection, so it re-derives as the user adds and removes movies. Disable it,
with the reason visible on hover/focus rather than a silent grey chip, when:

- no movies are selected yet ("Add a movie to use this");
- no selected movie has a release date ("No release date yet");
- the earliest release is already past ("_X_ is already out") — trading released
  movies is legal, so this is a normal case, not an error;
- the earliest release is less than the minimum away ("_X_ is out in 20 minutes").
  Do **not** silently bump this to the 1h minimum: the chip would then be lying
  about what it does.

If the selection changes so the chosen anchor becomes invalid, drop back to the
default window and say so — never submit a stale anchor.

**Re-resolution is the part that will get missed.** Release dates move; that is
what the daily `sync-release-dates` cron exists for. Two consequences:

- The `release_date` inside the offer's items JSONB is a **snapshot** taken by
  `enrichTradeItems` at proposal time and goes stale. Re-resolution must read
  `movies.release_date` live via the `movie_id` in the JSONB, never the snapshot.
- Open `first_release` offers need their `expires_at` recomputed. Put that in the
  `process-trades` sweep rather than bolting it onto `sync-release-dates`: it
  keeps all offer-expiry logic in one job and catches date changes from any
  source, not just the nightly sync.

Re-resolution rules: only for `status IN ('proposed','countered')` — an accepted
offer's clock is the review window's, and re-resolving it would be a silent
retroactive change to an agreed deal. If the date moves later, push `expires_at`
out and tell both parties ("_Dune 3_ moved to Dec 20 — your offer now stands until
then"). If it moves earlier but is still future, pull it in and tell them. If it
moves into the past, the next sweep expires the offer with
`expired_reason='movie_released'`.

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
- `offer_window` → "Expired — the offer window closed"
- `movie_released` → "Expired — _Dune 3_ released" (title read from the items JSONB)
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

- `propose-trade`, fixed expiry: in the past → 400; below min / above max → 400;
  beyond the league trade deadline → clamped, not rejected; omitted → null,
  null `expiry_anchor`, and the offer never expires. Include a test that submits
  a below-minimum time **directly to the edge function**, bypassing the picker —
  that is the case the UI cannot protect.
- `propose-trade`, release anchor: resolves to `min(release_date)` across **both**
  sides' movies, not just the proposer's; all-null release dates → 400; earliest
  release already past → 400; earliest release inside the minimum window → 400;
  resolved timestamp lands on the `isUpcomingMovie` boundary, not the raw date.
- Release re-resolution in `process-trades`: date moves later → open
  `first_release` offers move with it and both parties are notified; moves earlier
  but still future → pulled in; moves into the past → expired with
  `expired_reason='movie_released'` in the **same** run; `review`/`accepted` offers
  and `expiry_anchor='fixed'` offers are never touched; re-resolution reads
  `movies.release_date`, not the items JSONB snapshot (assert by changing the
  movie row and leaving the JSONB stale on purpose).
- `respond-trade`: accept an offer whose `expires_at` has passed but which the
  cron has **not** yet swept → 400 (this is the layer-1 guard, and the single most
  important test in the feature); accept at `expires_at - 1s` → succeeds.
- `counter-trade`: counter resets `expires_at` and `expiry_anchor` to the
  counterer's choice and clears `expiry_reminder_sent_at`; countering an
  already-lapsed offer → 400; a counter that changes the movie set re-resolves a
  release anchor against the new set.
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
- The custom picker on iOS Safari and Android Chrome inside the trade modal — the
  native picker must not be clipped or scroll-locked by the modal overlay.
- Custom picker across a timezone offset: pick 9:00 PM locally, confirm the stored
  UTC, the card countdown, the email, and the Discord `<t:…:R>` all agree.
- The release chip's live behavior: add a movie with an earlier release and watch
  the label and resolved time change; remove the last dated movie and confirm the
  chip disables and the selection falls back rather than submitting stale.

### Migration verification

Run `npx supabase migration up` (**not** `db reset`) against a DB carrying live
open offers; assert every pre-existing offer has `expires_at IS NULL`, a NULL
`expiry_anchor` (the paired CHECK constraint must accept the backfilled rows —
verify before shipping, since a violated table constraint fails the whole
migration), and that a sweep leaves all of them untouched.

---

## Phasing

**Phase 1 — the feature.** Migration; `respond_to_trade` / `counter_trade` guards;
sweep in `process-trades`; the chip row, shared `DateTimeField`, and release anchor
in `ProposeTradeModal`; server-side range checks; release re-resolution in the
cron; countdown + expired-reason copy in `TradeOfferCard`; expiry field in the
Discord embeds; expired notifications. Shippable and complete on its own.

The custom picker and the release anchor both belong here rather than in a later
phase: the picker is what makes the bounds real (and therefore what forces the
server-side range check to exist from day one), and the release anchor is the one
option that encodes the actual fantasy logic. Presets alone would ship a weaker
version of the thing people are already doing by hand.

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
race handling, shared `DateTimeField`) + reviewer. Handoff contracts:

- `trade_offers.expires_at` (timestamptz, nullable), `expiry_anchor`
  (`'fixed' | 'first_release' | null`, paired with `expires_at`), `expired_reason`
  (`'offer_window' | 'movie_released' | 'league_deadline' | null`).
- `propose-trade` and `counter-trade` bodies gain
  `expires_at?: string | null` (ISO-8601 UTC) and
  `expiry_anchor?: 'fixed' | 'first_release' | null`. The client always sends a
  resolved timestamp — the server re-derives and overrides it for
  `first_release` rather than trusting the client's arithmetic.
- `<DateTimeField value min max onChange error />` in
  `apps/frontend/app/components/DateTimeField.tsx`.

---

## Open questions

1. Default window — 48h, or no expiry unless the proposer opts in?
2. ~~**Release-anchor boundary**~~ — **decided: end of release day UTC**, the
   boundary `isUpcomingMovie()` already uses, so the codebase keeps one
   definition of "released". The tighter alternative (expire at the start of the
   release day) was rejected: it reads marginally better against the chip label
   but buys a second date rule, and the information gap it would close is
   already open days earlier when reviews land. Shipped in Phase 1.
3. Should the release anchor use the **earliest** release across the whole offer,
   or only the movies the *recipient* would be giving up? Earliest-overall is
   assumed here; recipient-side-only is arguable if the intent is "you can't sit
   on my offer until you know what my guy is worth".
4. Should a commissioner be able to *require* an expiry on every offer (and set a
   minimum), or is this purely per-proposer?
5. Should the league trade deadline auto-expire open offers, or leave them to die
   at accept time as they do now? (This plan assumes auto-expire.)
6. Is `animate-glow-pulse` allowed outside draft "your turn" states?
7. Does an expired offer stay visible in the trading feed indefinitely, or fold
   into a collapsed history section after some period?
