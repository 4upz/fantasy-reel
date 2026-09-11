# Routes

All page routes inherit the local brand fonts and shared `type-*` roles from
the root layout. Use [the typography guide](../../docs/brand/typography.md)
when designing a route; inspect the route's mobile, empty, and error states.

## Public Routes
- `/` → `apps/frontend/app/page.tsx` (Landing page)
- `/login` → `apps/frontend/app/(public)/login/page.tsx`
- `/signup` → `apps/frontend/app/(public)/signup/page.tsx`
- `/forgot-password` → `apps/frontend/app/(public)/forgot-password/page.tsx`
- `/reset-password` → `apps/frontend/app/(public)/reset-password/page.tsx`

## Auth Routes
- `/auth/callback` → `apps/frontend/app/auth/callback/route.ts`
- `/auth/confirm` → `apps/frontend/app/auth/confirm/route.ts`
- `/auth/signout` → `apps/frontend/app/auth/signout/route.ts`
- `/auth/auth-code-error` → `apps/frontend/app/auth/auth-code-error/page.tsx`
- `/auth/link-account` → `apps/frontend/app/auth/link-account/page.tsx`

## Authenticated Routes
- `/dashboard` → `apps/frontend/app/(authenticated)/dashboard/page.tsx`
- `/movies` → `apps/frontend/app/(authenticated)/movies/page.tsx`
- `/wishlist` → `apps/frontend/app/(authenticated)/wishlist/page.tsx`
- `/join` → `apps/frontend/app/(authenticated)/join/page.tsx`
- `/settings` → `apps/frontend/app/(authenticated)/settings/page.tsx`
- `/help` → `apps/frontend/app/(authenticated)/help/page.tsx`

## League Routes (`/league/[id]/`)
- `/league/[id]` → `apps/frontend/app/(authenticated)/league/[id]/page.tsx`
- `/league/[id]/dashboard` → `apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx`
- `/league/[id]/draft` → `apps/frontend/app/(authenticated)/league/[id]/draft/page.tsx`
- `/league/[id]/standings` → `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`
- `/league/[id]/roster` → `apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx`
- `/league/[id]/bidding` → `apps/frontend/app/(authenticated)/league/[id]/bidding/page.tsx`
- `/league/[id]/bidding/history` → `apps/frontend/app/(authenticated)/league/[id]/bidding/history/page.tsx`
- `/league/[id]/trading` → `apps/frontend/app/(authenticated)/league/[id]/trading/page.tsx`
- `/league/[id]/settings` → `apps/frontend/app/(authenticated)/league/[id]/settings/page.tsx`
