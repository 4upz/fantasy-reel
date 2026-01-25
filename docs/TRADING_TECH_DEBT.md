# Trading System Technical Debt

This document tracks known issues and improvements for the trading system, identified during code review on 2026-01-24.

## Critical (Fixed)

These issues have been resolved:

- [x] **`execute_trade` constraint violation** - Function inserted both `movie_id` AND `draft_pick_id`, violating `check_exactly_one_asset` constraint. Fixed in `20260130_fix_trade_assets_constraint.sql`.
- [x] **Counter button missing** - `onCounter` prop was wired but no button rendered. Fixed in `TradeOfferCard.tsx`.
- [x] **Veto used `window.prompt()`** - Poor UX, doesn't work on mobile. Replaced with `VetoModal` component.
- [x] **`process-trades` endpoint had no authentication** - Anyone could trigger trade processing. Fixed by adding CRON_SECRET check in `process-trades/index.ts`.
- [x] **RLS policy overly permissive** - Any league member could see all trades. Fixed in `20260131_trading_rls_restrictions.sql` - now only trade participants and league owners can view.

---

## Backend Issues

### High Priority

#### 1. Race Condition: Same Movie in Multiple Pending Trades
**Location:** `propose-trade/index.ts`, `counter-trade/index.ts`

**Problem:** A movie can be included in multiple pending trade offers simultaneously. If both trades are accepted, the same movie could be transferred twice.

**Solution:** Add a check before creating/updating trades:
```sql
-- Check if movie is already in a pending trade
SELECT 1 FROM trade_offers
WHERE league_id = $1
  AND status IN ('proposed', 'countered', 'review')
  AND (
    initiator_items->'movies' @> '[{"source_id": "..."}]'
    OR recipient_items->'movies' @> '[{"source_id": "..."}]'
  )
```

Or add a database constraint/trigger to enforce this.

---

#### 2. No Row-Level Locking on Trade Status Updates
**Location:** `respond-trade/index.ts`, `counter-trade/index.ts`, `veto-trade/index.ts`

**Problem:** Concurrent requests could update the same trade simultaneously, leading to inconsistent state.

**Solution:** Use `SELECT ... FOR UPDATE` when fetching the trade before modifying:
```sql
SELECT * FROM trade_offers WHERE id = $1 FOR UPDATE
```

The `execute_trade` function already does this, but the Edge Functions don't.

---

#### 3. FAAB Budget Race Condition
**Location:** `execute_trade` function, `_shared/trade-validation.ts`

**Problem:** If multiple trades involving the same team execute simultaneously, budget validation happens before the atomic transfer. Team could end up with negative FAAB.

**Solution:**
1. Lock team_budgets rows during validation: `SELECT ... FOR UPDATE`
2. Or use a database constraint: `CHECK (remaining_budget >= 0)`
3. Or serialize trade execution per team

---

### Medium Priority

#### 4. Counter-Offer Role Swap is Confusing (DOCUMENTED)
**Location:** `counter-trade/index.ts`, `20260201_trading_faab_config.sql`

**Status:** DOCUMENTED - Design decision explained

**Design Decision:** The role swap is intentional and simplifies the system:
- `initiator_team_id` = who proposed the CURRENT version of the trade
- `recipient_team_id` = who must RESPOND to the current version
- This means "who is waiting for a response" is always `recipient_team_id`

**Documentation Added:**
1. Detailed comment in `counter-trade/index.ts` explaining the swap
2. Comprehensive COMMENT on `counter_trade()` database function
3. Notification message updated: "You are now responding to their revised proposal"

**Why Keep It:**
- Simpler than tracking `current_proposer_team_id` separately
- Always clear who must act next (recipient_team_id)
- Alternative (new trade records) loses single-trade view

---

#### 5. Missing Uniqueness Constraint for Active Trades (FIXED)
**Location:** `20260131_trading_race_condition_fixes.sql`

**Status:** FIXED in prior migration

---

#### 6. Hard-Coded FAAB Maximum (FIXED)
**Location:** `_shared/trade-validation.ts`, `20260201_trading_faab_config.sql`

**Status:** FIXED

**Solution Implemented:**
1. Added `faab_budget` column to `leagues` table (default 100)
2. Updated `validateTradeItemsStructure()` to accept `maxFaab` parameter
3. Updated `getLeagueTradeConfig()` to fetch `faab_budget`
4. Updated `validateTradeProposal()` to use league's configured budget
5. Updated `validate_trade_items()` database function to use dynamic max
6. Error messages now show actual league limit: "FAAB must not exceed league budget of $X"

---

### Low Priority

#### 7. Email Notifications are Non-Blocking but Silent Failures
**Location:** `_shared/trade-validation.ts`

**Problem:** Email failures are caught and logged but not surfaced anywhere.

**Solution:** Consider adding a `notification_status` column or a separate notifications table to track delivery.

---

## Frontend Issues

### High Priority

#### 1. No Loading State for Recipient Movies
**Location:** `ProposeTradeModal.tsx:311-313`

**Problem:** When selecting a trade partner, the recipient's movies are fetched but only shows "Loading..." text. No spinner or skeleton.

**Solution:** Add a proper loading skeleton:
```tsx
{isLoadingRecipientMovies ? (
  <div className="space-y-2">
    {[1,2,3].map(i => (
      <div key={i} className="h-14 bg-surface-hover animate-pulse rounded-lg" />
    ))}
  </div>
) : (
  <MovieSelector ... />
)}
```

---

#### 2. No Confirmation Before Accepting Trade
**Location:** `TradeOfferCard.tsx:197-202`

**Problem:** Clicking "Accept" immediately triggers the action. Users could accidentally accept trades.

**Solution:** Add an `AcceptConfirmModal` similar to `VetoModal`:
```tsx
{showAcceptModal && (
  <AcceptConfirmModal
    trade={trade}
    onClose={() => setShowAcceptModal(false)}
    onConfirm={() => handleAction('accept')}
  />
)}
```

---

#### 3. Real-time Subscription Doesn't Update Roster
**Location:** `useTrading.ts`

**Problem:** After a trade completes, the `tradeableMovies` list isn't refreshed. Users still see movies they traded away.

**Solution:** Subscribe to `draft_picks` and `pickups` changes, or refetch `tradeableMovies` when a trade status changes to 'completed'.

---

### Medium Priority

#### 4. Supabase Client Created in Component Body
**Location:** `ProposeTradeModal.tsx:45`

**Problem:** `const supabase = createClient()` is called on every render.

**Solution:** Use `useMemo` or move outside component:
```typescript
const supabase = useMemo(() => createClient(), [])
```

---

#### 5. TypeScript Errors in Trading Files
**Location:** `ProposeTradeModal.tsx:71,94`, `useTrading.ts:104,127`

**Problem:** Type casting errors for movie data from Supabase queries.

**Solution:** Properly type the Supabase query responses or use type guards.

---

#### 6. No Accessibility Attributes
**Location:** All trading components

**Problem:** Missing `aria-label`, `role`, `aria-describedby` attributes on interactive elements.

**Solution:** Audit and add appropriate ARIA attributes:
```tsx
<button
  aria-label="Accept trade offer"
  aria-describedby="trade-summary"
  ...
>
```

---

### Low Priority

#### 7. No Empty State for "No Tradeable Movies"
**Location:** `ProposeTradeModal.tsx`, `CounterTradeModal`

**Problem:** If a team has no movies to trade, the UI just shows empty space.

**Solution:** Add helpful empty state:
```tsx
{movies.length === 0 && (
  <div className="text-center py-8">
    <p className="text-foreground-muted">No movies available to trade</p>
    <p className="text-sm text-foreground-muted mt-1">
      Draft or pick up movies first
    </p>
  </div>
)}
```

---

#### 8. Missing Keyboard Navigation
**Location:** All modals and interactive lists

**Problem:** Can't navigate movie selection with keyboard, modals don't trap focus.

**Solution:** Implement focus trap in modals, add keyboard handlers for lists.

---

#### 9. No Optimistic UI Updates
**Location:** `useTrading.ts`

**Problem:** All actions wait for server response before updating UI, causing perceived lag.

**Solution:** Implement optimistic updates with rollback on error.

---

## Testing Gaps

1. **Integration tests need Supabase keys** - Tests in `supabase/functions/tests/` require ES256 JWT keys that aren't easily accessible from new Supabase local setup.

2. **No E2E tests** - Trading flow should have Playwright tests covering:
   - Propose → Accept → Complete flow
   - Propose → Counter → Accept flow
   - Propose → Reject flow
   - Veto flow

3. **No load testing** - Race conditions won't surface without concurrent request testing.

---

## Related Files

- `supabase/migrations/20260128_create_trading_system.sql` - Schema
- `supabase/migrations/20260130_fix_trade_assets_constraint.sql` - Bug fix
- `supabase/migrations/20260131_trading_rls_restrictions.sql` - RLS security fix
- `supabase/functions/propose-trade/index.ts`
- `supabase/functions/respond-trade/index.ts`
- `supabase/functions/counter-trade/index.ts`
- `supabase/functions/cancel-trade/index.ts`
- `supabase/functions/veto-trade/index.ts`
- `supabase/functions/process-trades/index.ts`
- `apps/frontend/app/(authenticated)/league/[id]/components/TradeOfferCard.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/TradingPanel.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/ProposeTradeModal.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/hooks/useTrading.ts`
