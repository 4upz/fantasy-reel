# Plan: Trade offer expiry, phases 2 and 3

Phase 1 shipped in PR #67. This covers what the plan
(`docs/PLAN-trade-offer-expiry.md`) deferred, plus one loose end found during
its verification.

## Agent Team Strategy

**Topography:** Full-Stack Feature, run in two waves.

| Agent | Subagent type | Owns |
|---|---|---|
| lead | — | contracts, integration testing, browser verification, all commits |
| reminder-dev | claude (opus) | 2A: expiring-soon nudge |
| extend-dev | claude (opus) | 2B: extend-trade-offer |
| config-backend | claude (opus) | 3: league expiry config, server side |
| config-frontend | claude (opus) | 3: trade settings UI + bounds plumbing |

**Wave 1** — reminder-dev + extend-dev, in parallel. Disjoint files.
**Wave 2** — config-backend + config-frontend, in parallel, after wave 1 lands,
because both build on the resolver wave 1 leaves behind.

Nobody commits but the lead. Agents implement and typecheck; integration tests,
the simplifier pass and browser verification all happen centrally afterwards,
per the ordering in CLAUDE.md.

### File ownership (do not cross)

| Path | Owner |
|---|---|
| `supabase/migrations/20260825120000_*` | reminder-dev |
| `supabase/migrations/20260826120000_*` | extend-dev |
| `supabase/migrations/20260827120000_*` | config-backend |
| `supabase/functions/process-trades/index.ts` | reminder-dev |
| `supabase/functions/_shared/email.ts` | reminder-dev |
| `supabase/functions/extend-trade-offer/` | extend-dev |
| `supabase/config.toml` | extend-dev |
| `.../components/TradeOfferCard.tsx` | extend-dev |
| `.../components/TradingPanel.tsx` | extend-dev |
| `.../trading/TradingClient.tsx` | extend-dev (wave 1), config-frontend (wave 2) |
| `apps/frontend/utils/analytics.ts` | extend-dev |
| `supabase/functions/update-league/index.ts` | config-backend |
| `supabase/functions/_shared/trade-expiry.ts` | config-backend |
| `apps/discord-bot/src/commands/league-options.ts` | config-backend |
| `.../settings/components/TradeConfigSection.tsx` | config-frontend |
| `apps/frontend/utils/tradeExpiry.ts` | config-frontend |
| `.../hooks/useOfferExpiry.ts`, `.../components/OfferExpiryPicker.tsx` | config-frontend |

**Migration versions are pre-assigned above.** Three branches have already
collided on a version in this repo (see `docs/PLAN-trade-offer-expiry.md`); a
duplicate is silently skipped rather than flagged, so do not pick your own.

## Handoff contracts

Fixed before anyone starts. Change only by asking the lead.

### 2A — reminder

```sql
-- Claims offers due a nudge and stamps them in one statement, so overlapping
-- cron runs cannot double-send. Returns the rows claimed.
claim_expiry_reminders(p_lead interval) RETURNS SETOF trade_offers
```
Fires once per offer, at `min(6h, 25% of the window)` remaining; never for
windows under 2h. `expiry_reminder_sent_at` already exists and is already reset
on counter-offer and on release re-resolution — nothing to add there.

`TradeEmailType` gains `'expiring_soon'`. In-app notification reuses type
`'trade_proposed'` (adding a `notification_type` enum value costs two
migrations, since a new value cannot be used in the transaction that adds it).

### 2B — extend

```
POST /functions/v1/extend-trade-offer  { trade_offer_id, expires_at }
  -> 200 { trade_offer }   400 on bounds/ownership/status refusal
```
```sql
extend_trade_offer(p_trade_id uuid, p_expires_at timestamptz) RETURNS jsonb
```
Proposer only. Forward only — a new time at or before the current `expires_at`
is refused. Open statuses only (`proposed`, `countered`). Re-checks the same
`MAX_EXPIRY_DAYS` bound and league-deadline clamp as `resolveOfferExpiry`, and
resets `expiry_reminder_sent_at` so the nudge can fire again on the new window.

**Decision (lead):** extending a `movie_release` offer converts it to `fixed`
and clears `expiry_anchor_movie_id`. Any extension necessarily runs past the
release it was waiting on, so the anchor stops being true; the button says so
rather than silently redefining the offer. Reversible if it reads wrong in use.

### 3 — league configuration

```sql
ALTER TABLE leagues
  ADD COLUMN trade_offer_expiry_default_hours INTEGER,  -- NULL = app default (48)
  ADD COLUMN trade_offer_expiry_min_hours     INTEGER,  -- NULL = app default (1)
  ADD COLUMN trade_offer_expiry_max_days      INTEGER;  -- NULL = app default (14)
```
```
POST /functions/v1/update-league { action: 'update_trade_config', league_id,
  trades_enabled?, trade_deadline?, trade_review_enabled?, trade_veto_hours?,
  trade_offer_expiry_default_hours?, trade_offer_expiry_min_hours?,
  trade_offer_expiry_max_days? }
```

The discriminator is `action`, not `type` (corrected by the lead after checking
`update-league/index.ts:139` and `BiddingConfigSection.tsx:97` — the first draft
of this contract had it wrong). Only the league owner may call it; that check
already exists ahead of the switch. `BiddingConfigSection.tsx` is the model to
follow for the UI section, including its named min/max constants and its
`toast` + `onUpdate(league)` result handling.

`ExpiryBounds` is the shape that crosses the boundary:

```ts
interface ExpiryBounds { defaultHours: number; minMinutes: number; maxDays: number }
```

`resolveOfferExpiry` takes it in `context` instead of reading module constants;
the module constants become the fallback when a league leaves a field NULL.
The frontend receives the same shape from the league row and passes it to
`useOfferExpiry`, which hands `min`/`max` to `DateTimeField` and the preset row.
The frontend must stop hardcoding `MIN_EXPIRY_MINUTES` / `MAX_EXPIRY_DAYS` in
its validation, but keeps them as the fallback constants.

Checked by the lead so nobody has to rediscover it: `trading/page.tsx` already
does `select('*')` on `leagues` and hands the row to `TradingClient`, so the new
columns arrive with no extra query. The plumbing is prop-drilling only —
`TradingClient` -> `ProposeTradeModal` -> `useOfferExpiry`, and
`TradeOfferCard` -> `CounterTradeModal` -> `useOfferExpiry`. Derive the bounds
once in `TradingClient` rather than in each modal.

## Decisions taken mid-flight

- **Extend needs three more files than the table listed** (`TradingPanel.tsx`,
  `TradingClient.tsx`, `analytics.ts`) — the card is fed through the panel from
  the client, so an `onExtend` prop cannot reach it otherwise. Granted to
  extend-dev in wave 1. `TradingClient.tsx` changes hands to config-frontend in
  wave 2, which is sequential and therefore safe; config-frontend should expect
  an extend prop already threaded through it.
- **No notification when an offer is extended.** An extension only ever moves in
  the recipient's favour, and they already see the new clock through the
  existing `trade_offers` realtime subscription, so a "you have more time" ping
  is noise. The edge case — a recipient who already got an expiring-soon nudge —
  is covered because `extend_trade_offer` resets `expiry_reminder_sent_at`, so a
  fresh nudge fires against the new window.

## Loose end (lead)

`process-trades` counts a trade that fails re-validation into `results.errors`
without incrementing `failed`, so `job_status` reports `ok` with errors present.
Same class as the bug fixed for the expiry sweep in PR #67. Lead fixes it.

## Verification (lead, after all agents)

1. `/simplify` over the whole diff.
2. `npx supabase db reset` — all three migrations apply in order.
3. `npm run test:functions` — the 8 trade files plus whatever the agents add.
4. Browser: nudge copy, extend button, trade settings section.
5. Screenshots to the PR.
