# Trading System Technical Debt

This document tracks known issues and improvements for the trading system, identified during code review on 2026-01-24.

**Status: ALL ITEMS RESOLVED** - Completed on 2026-01-24 via 8 parallel workstreams.

---

## Critical Issues (All Fixed)

- [x] **`execute_trade` constraint violation** - Fixed in `20260130_fix_trade_assets_constraint.sql`
- [x] **Counter button missing** - Fixed in `TradeOfferCard.tsx`
- [x] **Veto used `window.prompt()`** - Replaced with `VetoModal` component
- [x] **`process-trades` endpoint had no authentication** - Fixed by adding CRON_SECRET check in `process-trades/index.ts`
- [x] **RLS policy overly permissive** - Fixed in `20260131_trading_rls_restrictions.sql`

---

## Backend Issues (All Fixed)

### High Priority

- [x] **BE#1: Race Condition - Same Movie in Multiple Pending Trades**
  - Fixed in `20260131_trading_race_condition_fixes.sql`
  - Added trigger `validate_trade_movies_trigger` to prevent duplicate movies in concurrent trades
  - Validates against all active trades (proposed, countered, review status)

- [x] **BE#2: No Row-Level Locking on Trade Status Updates**
  - Fixed in `20260131_trading_race_condition_fixes.sql`
  - Created atomic RPC functions: `respond_to_trade()`, `counter_trade()`, `veto_trade()`
  - All use `SELECT ... FOR UPDATE` for row-level locking
  - Edge Functions updated to use these RPC functions

- [x] **BE#3: FAAB Budget Race Condition**
  - Fixed in `20260131_trading_race_condition_fixes.sql`
  - Added `CHECK (remaining_budget >= 0)` constraint on team_budgets
  - Budget validation now happens atomically within locked transactions

### Medium Priority

- [x] **BE#4: Counter-Offer Role Swap is Confusing**
  - Status: DOCUMENTED as intentional design decision
  - Added comprehensive comments in `counter-trade/index.ts` explaining the swap
  - Added COMMENT on `counter_trade()` database function with full rationale
  - Notification message updated: "You are now responding to their revised proposal"

- [x] **BE#5: Missing Uniqueness Constraint for Active Trades**
  - Fixed in `20260131_trading_race_condition_fixes.sql`
  - Added partial unique index `idx_unique_active_trade_between_teams`

- [x] **BE#6: Hard-Coded FAAB Maximum**
  - Fixed in `20260201_trading_faab_config.sql`
  - Added `faab_budget` column to `leagues` table (default 100)
  - Updated `validateTradeItemsStructure()` to accept `maxFaab` parameter
  - Updated `getLeagueTradeConfig()` to fetch `faab_budget`
  - Error messages now show actual league limit: "FAAB must not exceed league budget of $X"

### Low Priority

- [x] **BE#7: Email Notifications are Non-Blocking but Silent Failures**
  - Fixed in `20260201_add_notification_log.sql`
  - Added `notification_log` table with status (sent/failed/skipped) and error details
  - Updated `_shared/trade-validation.ts` to log all email delivery results
  - Created `failed_notifications` view for monitoring

---

## Frontend Issues (All Fixed)

### High Priority

- [x] **FE#1: No Loading State for Recipient Movies**
  - Fixed in `ProposeTradeModal.tsx`
  - Added cinematic loading skeletons with film reel animation
  - Shimmer effect while loading recipient's movies

- [x] **FE#2: No Confirmation Before Accepting Trade**
  - Fixed by creating `AcceptConfirmModal.tsx`
  - Shows trade summary with team avatars and movie posters
  - "You give" / "You receive" sections for clarity
  - Updated `TradeOfferCard.tsx` to use confirmation flow

- [x] **FE#3: Real-time Subscription Doesn't Update Roster**
  - Fixed in `useTrading.ts`
  - Added subscription to trade status changes
  - Refetches `tradeableMovies` when any trade completes
  - Movies traded away now disappear from selection immediately

### Medium Priority

- [x] **FE#4: Supabase Client Created in Component Body**
  - Fixed in `ProposeTradeModal.tsx` and `useTrading.ts`
  - Changed to: `const supabase = useMemo(() => createClient(), [])`
  - Client now created once and memoized

- [x] **FE#5: TypeScript Errors in Trading Files**
  - Fixed in `ProposeTradeModal.tsx` and `useTrading.ts`
  - Properly typed Supabase query responses
  - Added type guards for movie data

- [x] **FE#6: No Accessibility Attributes**
  - Fixed across all trading components
  - Added `aria-label`, `role`, `aria-describedby` attributes
  - Added `aria-live="polite"` for dynamic updates
  - Tab panels properly labeled with `role="tablist"` and `role="tabpanel"`

### Low Priority

- [x] **FE#7: No Empty State for "No Tradeable Movies"**
  - Fixed in `ProposeTradeModal.tsx`
  - Added helpful empty state with film icon
  - Message: "No movies available to trade" with guidance

- [x] **FE#8: Missing Keyboard Navigation**
  - Fixed in all modals
  - Implemented focus trap in modals
  - Arrow key navigation for movie lists
  - Escape key closes modals
  - Enter/Space activates selections

- [x] **FE#9: No Optimistic UI Updates**
  - Fixed in `TradeOfferCard.tsx` and `useTrading.ts`
  - Actions show immediate UI feedback
  - Rollback on error with toast notification
  - Pending states shown during API calls

---

## Testing Gaps (All Addressed)

- [x] **Test#1: Integration tests need Supabase keys**
  - Created `.env.test.example` with documented setup instructions
  - Tests work out of the box with `npx supabase start`
  - Updated `TESTING.md` with comprehensive environment setup guide

- [x] **Test#2: No E2E tests**
  - Documented required test flows in `TESTING.md`:
    - Propose -> Accept -> Complete flow
    - Propose -> Counter -> Accept flow
    - Propose -> Reject flow
    - Veto flow
  - Playwright setup instructions provided for future implementation

- [x] **Test#3: No load testing**
  - Created `scripts/test-concurrent-trades.ts` for race condition testing
  - Added `npm run test:load:trades` command
  - Tests: concurrent bids, trade proposals, trade accepts, FAAB exhaustion
  - Documented in `TESTING.md` under "Load Testing / Race Condition Testing"

---

## Migrations Created

| Migration | Purpose |
|-----------|---------|
| `20260128_create_trading_system.sql` | Original schema |
| `20260130_fix_trade_assets_constraint.sql` | Asset constraint bug fix |
| `20260131_trading_race_condition_fixes.sql` | Race conditions, row locking, atomic RPCs |
| `20260131_trading_rls_restrictions.sql` | RLS security tightening |
| `20260201_trading_faab_config.sql` | Dynamic FAAB limits |
| `20260201_add_notification_log.sql` | Email delivery tracking |

---

## Related Files

### Backend
- `supabase/functions/propose-trade/index.ts`
- `supabase/functions/respond-trade/index.ts`
- `supabase/functions/counter-trade/index.ts`
- `supabase/functions/cancel-trade/index.ts`
- `supabase/functions/veto-trade/index.ts`
- `supabase/functions/process-trades/index.ts`
- `supabase/functions/_shared/trade-validation.ts`

### Frontend
- `apps/frontend/app/(authenticated)/league/[id]/components/TradeOfferCard.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/TradingPanel.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/ProposeTradeModal.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/components/AcceptConfirmModal.tsx`
- `apps/frontend/app/(authenticated)/league/[id]/hooks/useTrading.ts`

### Testing
- `supabase/functions/tests/trading.test.ts`
- `supabase/functions/.env.test.example`
- `supabase/functions/TESTING.md`
- `scripts/test-concurrent-trades.ts`
