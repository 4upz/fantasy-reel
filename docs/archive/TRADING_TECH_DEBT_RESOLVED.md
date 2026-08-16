# Trading System Technical Debt - RESOLVED

All 21 items identified on 2026-01-24 have been resolved.

---

## Migrations Created

| Migration | Items Fixed |
|-----------|-------------|
| `20260130_fix_trade_assets_constraint.sql` | execute_trade constraint violation |
| `20260131_trading_race_condition_fixes.sql` | BE#1-3, BE#5: Race conditions, row locking, atomic RPCs |
| `20260131_trading_rls_restrictions.sql` | BE#4: RLS trade visibility |
| `20260201_trading_faab_config.sql` | BE#6: Dynamic fantasy budget limits |
| `20260201_add_notification_log.sql` | BE#7: Email delivery tracking |

---

## Summary by Category

### Backend (7 items)
| # | Issue | Fix |
|---|-------|-----|
| BE#1 | Movie in multiple pending trades | Trigger `validate_trade_movies_trigger` |
| BE#2 | No row-level locking | Atomic RPCs with `SELECT ... FOR UPDATE` |
| BE#3 | Fantasy budget race condition | `CHECK (remaining_budget >= 0)` constraint |
| BE#4 | Counter-offer role swap confusing | Documented as intentional design |
| BE#5 | Missing uniqueness constraint | Partial unique index on active trades |
| BE#6 | Hard-coded budget max | `faab_budget` column on leagues |
| BE#7 | Silent email failures | `notification_log` table |

### Frontend (9 items)
| # | Issue | Fix |
|---|-------|-----|
| FE#1 | No loading state | Loading skeletons in ProposeTradeModal |
| FE#2 | No accept confirmation | AcceptConfirmModal component |
| FE#3 | Roster not refreshing | Subscribe to trade completion in useTrading |
| FE#4 | Supabase client recreation | `useMemo(() => createClient(), [])` |
| FE#5 | TypeScript errors | Proper typing for Supabase queries |
| FE#6 | No ARIA attributes | 41+ attributes across trading components |
| FE#7 | No empty state | Empty state in MovieSelector |
| FE#8 | No keyboard navigation | Focus trap, arrow keys, Escape to close |
| FE#9 | No optimistic updates | Immediate UI feedback with rollback |

### Testing (3 items)
| # | Issue | Fix |
|---|-------|-----|
| Test#1 | Missing env setup | `.env.test.example` with docs |
| Test#2 | No E2E tests | Documented flows in TESTING.md |
| Test#3 | No load testing | `scripts/test-concurrent-trades.ts` |

### Critical (5 items - pre-existing)
| Issue | Fix |
|-------|-----|
| execute_trade constraint | `20260130_fix_trade_assets_constraint.sql` |
| Counter button missing | Added to TradeOfferCard |
| Veto used window.prompt() | VetoModal component |
| process-trades no auth | CRON_SECRET check |
| RLS overly permissive | `20260131_trading_rls_restrictions.sql` |

---

## Key Files

**Backend:** `supabase/functions/{propose,respond,counter,cancel,veto,process}-trade/index.ts`

**Frontend:** `apps/frontend/app/(authenticated)/league/[id]/components/{TradeOfferCard,TradingPanel,ProposeTradeModal,AcceptConfirmModal}.tsx`, `hooks/useTrading.ts`

**Testing:** `scripts/test-concurrent-trades.ts`, `supabase/functions/.env.test.example`
