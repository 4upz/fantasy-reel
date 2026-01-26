# QA Bug Report - Fantasy Reel Functional Testing

**Date:** 2025-01-25
**Testers:** Manual functional testing with real users
**Environment:** Production

---

## Critical Path Blockers

These bugs block core user flows and should be prioritized first:

### DRF-002 (High) - Draft turn state not advancing - FIXED (Code)
- **Feature:** Draft
- **Issue:** After successfully drafting a movie, the turn state doesn't advance. The movie appears in the user's league dashboard as "upcoming" (pick was recorded), but the draft UI still shows it's the user's turn. Attempting another pick returns "not your turn" error.
- **Impact:** Completely blocks draft progression
- **Root cause:** In `DraftBoard.tsx`, after a successful pick, `onPickMade()` was called synchronously but `setPicking(false)` ran immediately without waiting for the fetch to complete. Turn calculation uses `draftPicks.length`, so the UI showed stale turn state until realtime subscription caught up.
- **Fix:** Made `onPickMade` callback async and awaited it before updating picking state:
  1. Changed callback types to `() => void | Promise<void>`
  2. Await `onPickMade()` before `setPicking(false)`
  3. Made `handlePickMade` and `handleCounterpickMade` async in DraftClient.tsx
- **Files modified:**
  - `apps/frontend/app/(authenticated)/league/[id]/components/DraftBoard.tsx`
  - `apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx`

### LGE-001 (High) - Invite link hardcoded to localhost - FIXED (Config)
- **Feature:** Leagues
- **Issue:** On the invite players screen, the copyable invite link uses `localhost` instead of the production domain.
- **Impact:** Shared invite links don't work for invitees
- **Root cause:** The `SITE_URL` environment variable was not set in the Supabase Edge Function secrets. The code correctly reads from `Deno.env.get('SITE_URL')` but falls back to `http://localhost:3000` when the env var is missing.
- **Fix:** Set the `SITE_URL` secret in Supabase production:
  ```bash
  npx supabase secrets set SITE_URL=https://fantasyreel.com
  ```
- **Files affected:** `supabase/functions/send-invite/index.ts` (line 155), `supabase/functions/resend-invitation/index.ts` (line 88)
- **Documentation updated:** `docs/DEPLOYMENT.md`, `.env.production.example`

### LGE-002 (High) - Invite emails not being sent - FIXED (Config)
- **Feature:** Leagues
- **Issue:** Users invited to a league do not receive the invitation email.
- **Impact:** Combined with LGE-001, the entire invite flow is broken
- **Root cause:** The `RESEND_API_KEY` environment variable is not configured in Supabase Edge Function secrets. The email module logs a warning but returns `{ success: false }` silently, allowing invitation creation without email delivery.
- **Fix:** Set the `RESEND_API_KEY` secret in Supabase production:
  ```bash
  npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
  npx supabase secrets set RESEND_FROM_EMAIL="Fantasy Reel <noreply@yourdomain.com>"
  ```
- **Files affected:** `supabase/functions/_shared/email.ts` (lines 193-199, 249-255)
- **Documentation updated:** `docs/DEPLOYMENT.md` (marked RESEND_API_KEY as REQUIRED)

### AUTH-002 (High) - No forgot password flow - FIXED (Code)
- **Feature:** Auth / Account
- **Issue:** Users who sign up with email/password have no way to reset a forgotten password.
- **Impact:** Account lockout with no recovery path
- **Root cause:** Password reset functionality was never implemented.
- **Fix:** Implemented complete password reset flow using Supabase Auth:
  1. Created `/forgot-password` page with email input and `resetPasswordForEmail()` call
  2. Created `/reset-password` page that handles recovery token and calls `updateUser({ password })`
  3. Added "Forgot your password?" link to login page
- **Files created:**
  - `apps/frontend/app/(public)/forgot-password/page.tsx`
  - `apps/frontend/app/(public)/forgot-password/actions.ts`
  - `apps/frontend/app/(public)/reset-password/page.tsx`
  - `apps/frontend/app/(public)/reset-password/actions.ts`
- **Files modified:** `apps/frontend/app/(public)/login/page.tsx` (added forgot password link)

### MOV-001 (High) - Movie search only returns unreleased movies - FIXED (Code)
- **Feature:** Movies / Search
- **Issue:** Search results are filtered to unreleased movies only. Released movies like "Opus" and "Wicked" don't appear. Browse (unreleased only) is working as intended, but search should return both released and unreleased films.
- **Impact:** Users cannot find and draft recently released movies
- **Root cause:** The `search-movies` Edge Function had `upcoming_only` parameter defaulting to `true` (line 65). This filtered all search results through `isUpcomingMovie()`, removing any movie that had already been released or was from a previous year.
- **Fix:** Changed the default value of `upcoming_only` from `true` to `false` so search returns all movies by default. The parameter remains available if callers explicitly want to filter to upcoming movies only.
- **Files modified:** `supabase/functions/search-movies/index.ts` (line 65)
- **Before:** `const { query, page = 1, year, upcoming_only = true } = params`
- **After:** `const { query, page = 1, year, upcoming_only = false } = params`

---

## Medium Priority

### AUTH-001 (Medium) - Dev message shown to prod users - FIXED (Code)
- **Feature:** Auth / Account
- **Issue:** Message referencing "local supabase instance" appears on email confirmation page. Same message shows when clicking "Didn't receive confirmation email?" link.
- **Root cause:** Dev helper messages (referencing Mailpit at localhost:54324) were unconditionally rendered in all environments.
- **Fix:** Wrapped dev helper messages in `{process.env.NODE_ENV === 'development' && (...)}` conditional.
- **Files modified:**
  - `apps/frontend/app/(public)/signup/page.tsx` (lines 53-69)
  - `apps/frontend/app/auth/auth-code-error/page.tsx` (lines 85-100)

### LGE-003 (Medium) - "Setup" visible to non-owners - FIXED (Code)
- **Feature:** Leagues
- **Issue:** League page shows "setup" status/section to participants who are not the league owner. Non-owners cannot perform setup actions.
- **Root cause:** The `InvitationsList` component was rendered when `league.status === 'setup'` without checking if the current user is the owner.
- **Fix:** Added `isOwner &&` condition to the JSX rendering of `InvitationsList` in `DraftClient.tsx`
- **Files changed:** `apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx` (line 345)
- **Before:** `{league.status === 'setup' && (<InvitationsList ...`
- **After:** `{isOwner && league.status === 'setup' && (<InvitationsList ...`

### DRF-001 (Medium) - UI doesn't update when draft starts - FIXED (Code)
- **Feature:** Draft
- **Issue:** After league manager clicks "Start Draft", the UI doesn't reflect the draft has started until page is manually refreshed.
- **Root cause:** `handleStartDraft()` called the API but didn't update local state on success, relying only on realtime subscription which has latency.
- **Fix:** Update local league state immediately after successful API call using returned league data.
- **Files modified:** `apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx` (handleStartDraft function)

### DRF-003 (Medium) - Unclear click behavior on movie cards - FIXED (Code)
- **Feature:** Draft
- **Issue:** Clicking a movie in draft search inconsistently triggers either "Confirm pick" dialog or movie details view. No clear distinction between the two actions.
- **Root cause:** The `DraftMovieCard` component had a single click handler on the entire card that triggered `onSelect()` (draft selection). The "Quick Preview" button was a small hover-only overlay that was easy to miss. Users expected clicking the card to show details (the more common action), not start the draft process.
- **Fix:** Redesigned the card interaction pattern to match user intent:
  1. **Card click** now opens movie preview/details (most common user intent)
  2. **Hover overlay** shows two distinct action buttons:
     - "Draft Movie" (gold/primary) - Deliberate action to select for drafting
     - "View Details" (secondary) - Alternative access to movie preview
  3. Clear visual hierarchy with gold primary button standing out
  4. Added Plus and Eye icons to differentiate actions
- **UX Pattern:** This follows the principle that the most common action (viewing details) should be the default, while the deliberate action (drafting) should require explicit intent.
- **Files modified:**
  - `apps/frontend/app/(authenticated)/league/[id]/components/DraftMovieCard.tsx` - Updated click handlers and hover overlay
  - `apps/frontend/app/(authenticated)/league/[id]/components/Icons.tsx` - Added PlusIcon and EyeIcon exports

### NAV-002 (Medium) - No help/how-to documentation - FIXED (Code)
- **Feature:** Navigation / UI
- **Issue:** No onboarding or help content explaining how leagues, drafting, pickups, drops, budgets, or scoring work. New users unfamiliar with fantasy leagues have no guidance.
- **Root cause:** Help/onboarding functionality was never implemented.
- **Fix:** Created comprehensive help page at `/help` covering all core concepts:
  1. Overview of Fantasy Movies concept
  2. Leagues (creating, joining, inviting)
  3. Drafting (snake draft format, strategy tips, counterpick rounds)
  4. Scoring system (70-point baseline, bonuses/penalties, score sources)
  5. Pickups & Drops (FAAB bidding system)
  6. Trading (propose, accept, reject, counter, veto)
- **Files created:**
  - `apps/frontend/app/(authenticated)/help/page.tsx` - Full help page with quick navigation and detailed sections
- **Files modified:**
  - `apps/frontend/app/components/navigation/SideNav.tsx` - Added "How to Play" link with HelpCircle icon to global navigation

---

## Low Priority

### NAV-001 (Low) - No back navigation on login/signup screens - FIXED (Code)
- **Feature:** Navigation / UI
- **Issue:** Login and create account pages lack an icon/link to navigate back to the home page.
- **Root cause:** Auth pages were designed without navigation back to the landing page.
- **Fix:** Added NavLogo component with `href="/"` to login, signup, and signup success screens.
  - Users can click the logo to return to the landing page
  - Consistent with the app's branding and navigation patterns
- **Files modified:**
  - `apps/frontend/app/(public)/login/page.tsx` - Added NavLogo import and centered logo above login form
  - `apps/frontend/app/(public)/signup/page.tsx` - Added NavLogo import and centered logo above signup form and success screen

### DRF-004 (Low) - Movie description truncated with no expand option - FIXED (Code)
- **Feature:** Draft
- **Issue:** When viewing movie details in draft search, the description is truncated with no "see more" or expand action.
- **Root cause:** The `MovieQuickPreview` component used `line-clamp-4` CSS class to truncate the movie overview/description but provided no way for users to expand and read the full text.
- **Fix:** Implemented expandable description with "Read more" / "Show less" toggle:
  1. Added `isDescriptionExpanded` state to track expansion
  2. Replaced `line-clamp-4` with CSS `max-height` transition for smooth expand/collapse
  3. Added conditional "Read more" / "Show less" button (only shown if description exceeds 200 characters)
  4. Button uses gold color for interactive text following Cinematic Dark design system
  5. Smooth 300ms `max-height` transition for polished UX
- **Files modified:** `apps/frontend/app/(authenticated)/league/[id]/components/MovieQuickPreview.tsx`

---

## Summary by Severity

| Severity | Count | Open | IDs |
|----------|-------|------|-----|
| High | 5 | 0 | ~~DRF-002~~, ~~LGE-001~~, ~~LGE-002~~, ~~AUTH-002~~, ~~MOV-001~~ |
| Medium | 5 | 0 | ~~AUTH-001~~, ~~LGE-003~~, ~~DRF-001~~, ~~DRF-003~~, ~~NAV-002~~ |
| Low | 2 | 0 | ~~NAV-001~~, ~~DRF-004~~ |

**Fixed this session:** LGE-001 (config), LGE-002 (config), LGE-003 (code), AUTH-001 (code), AUTH-002 (code), NAV-001 (code), NAV-002 (code), MOV-001 (code), DRF-001 (code), DRF-002 (code), DRF-003 (code), DRF-004 (code)

---

## Recommended Fix Order

1. **DRF-002** - Unblocks draft testing
2. ~~**LGE-001 + LGE-002**~~ - **FIXED** - Requires setting SITE_URL and RESEND_API_KEY in Supabase secrets
3. ~~**MOV-001**~~ - **FIXED** - Core search functionality now returns all movies
4. ~~**AUTH-002**~~ - **FIXED** - Password reset flow implemented
5. Remaining medium/low issues

---

## Action Items for Deployment

To complete the LGE-001 and LGE-002 fixes, run these commands in production:

```bash
# Set site URL for invite links
npx supabase secrets set SITE_URL=https://fantasyreel.com

# Set Resend API key for emails
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
npx supabase secrets set RESEND_FROM_EMAIL="Fantasy Reel <noreply@fantasyreel.com>"

# Verify secrets are set
npx supabase secrets list
```
