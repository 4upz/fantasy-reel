## Project Context
- This is a Next.js + Supabase + TypeScript fantasy movies app (Fantasy Reel) deployed on Vercel.
- Frontend project on Vercel is named `fantasy-reel-frontend` (not `fantasy-reel`).
- Design system conventions exist — check existing components before creating new patterns.

# Fantasy Movies App

Developer context for the Fantasy Movies web application - a fantasy league platform for movies.

---

## Development Workflow

**IMPORTANT: After completing each implementation step, follow this order:**

1. Run the `code-simplifier:code-simplifier` agent on the recently modified code
2. The agent will review and refactor for clarity, consistency, and reduced duplication
3. **Then** run UI/e2e verification (browser automation) on the simplified code
4. Commit the changes

This order ensures verification is performed on the final state of the code, not on code that will be modified by the simplifier.

**Planning:** During plan mode, evaluate whether the task benefits from agent team parallelization (see [Agent Teams](#agent-teams) below). Propose a topography in the plan file when criteria are met.

**UI/Frontend Changes:**

When implementing any UI changes, new components, or frontend features, **always invoke the `frontend-design` skill first** using `/frontend-design` or the Skill tool. This skill ensures:
- Consistent application of the Cinematic Dark design system
- High-quality, distinctive UI that avoids generic "AI slop" aesthetics
- Proper use of design tokens, component classes, and animations
- Production-grade, polished implementation

**Verifying Frontend Changes:**

After implementing frontend code and running the code-simplifier, verify the changes work correctly:

1. **Restart the dev server** - Always stop and restart the dev server before testing to ensure the latest code is running:
   ```bash
   # Kill any running dev server, then restart
   npm run dev
   ```

2. **Log in with a seeded test user** - Use one of the pre-seeded test accounts from `supabase/seed.sql`:
   | Email | Password | Display Name |
   |-------|----------|--------------|
   | `alice@fantasyreel.test` | `testpass123!` | Alice Spielberg |
   | `bob@fantasyreel.test` | `testpass123!` | Bob Nolan |
   | `carol@fantasyreel.test` | `testpass123!` | Carol Coppola |
   | `dave@fantasyreel.test` | `testpass123!` | Dave Kubrick |

   **Note:** If users don't exist, run `npx supabase db reset` to re-seed the database.

3. **Use browser automation to test** - Use the `mcp__claude-in-chrome__*` tools to:
   - Navigate to the relevant page
   - Interact with the new UI elements
   - Verify the expected behavior occurs
   - Check for console errors using `mcp__claude-in-chrome__read_console_messages`

**Example verification flow:**
```
1. Run code-simplifier on modified files
2. Restart dev server: npm run dev
3. Navigate to http://localhost:3000/login
4. Log in as alice@fantasyreel.test / testpass123!
5. Navigate to the page with your changes
6. Interact with the new feature
7. Verify expected behavior and no console errors
8. Commit the changes
```

---

## Agent Teams

### Concepts

**Agent:** A focused Claude Code session (spawned via the Task tool) assigned a specific role and subset of work. Agents run in parallel on different subsystems while sharing a common plan file with handoff contracts.

**Agent Roles:**
- `lead` — Coordinates the team, merges work from other agents, owns all commits and final sign-off
- `backend-dev` / `frontend-dev` — General-purpose implementers scoped to a subsystem
- `fn-dev-a` / `fn-dev-b` — Edge Function implementers for parallel backend work
- `qe-assessor` / `verifier` — Test analysis and verification specialists
- `reviewer` — Code review and quality checks
- `explorer` / `architect` / `implementer` — Investigation → design → build pipeline for unfamiliar code
- `unit-tester` / `e2e-tester` — Test coverage specialists for Deno and Playwright respectively

**Coordination:** Agents work in separate contexts but share a task list and plan file. The lead spawns agents, assigns tasks, and merges their output. Handoff contracts (types, schemas, function signatures) are defined upfront so agents can work independently.

### When to Use a Team

- **Use a team when:** task touches 2+ independent subsystems (e.g. migration + Edge Function + frontend), modifies 6+ files across those subsystems, or has parallelizable chunks. Example: adding a new feature that needs a DB migration, an Edge Function, and a UI page — three agents can work simultaneously.
- **Skip teams when:** single-file fix, purely sequential dependency chain, exploration-only task, or changes are confined to one subsystem with <3 files. Example: fixing a bug in one Edge Function or tweaking a single component.

### Topographies

| Topography | When | Agents |
|---|---|---|
| Full-Stack Feature | migration + Edge Function + frontend | lead + backend-dev + frontend-dev + reviewer |
| UI Refactor + QE | layout/nav changes that may break E2E selectors | lead + qe-assessor + verifier |
| Backend Batch | 3+ related Edge Functions sharing utils | lead + fn-dev-a + fn-dev-b |
| Explore → Plan → Implement | unfamiliar code, bug investigation, unclear scope | explorer + architect + implementer |
| Test Hardening | adding test coverage across Deno + Playwright | lead + unit-tester + e2e-tester |

### Coordination Rules

1. Implementation CAN be parallelized across agents touching different subsystems
2. Code-simplifier runs AFTER all agents finish, before testing
3. Deno tests SHOULD run AFTER code-simplifier to catch any inadvertent logic changes. If tests fail after simplification, the simplifier's changes must be reviewed before proceeding.
4. Browser verification runs AFTER code-simplifier
5. Lead always owns commits

### Handoff Contracts

When splitting work across agents, define these in the plan file before agents start:
- Edge Function request/response shapes (TypeScript types)
- DB table/column names from migrations
- Component prop interfaces
- Shared utility function signatures

### Plan File Template

```
## Agent Team Strategy
**Topography:** [name from table above]

| Agent | Subagent Type | Owns |
|---|---|---|
| lead | — | coordination, commits |
| backend-dev | general-purpose | migration, Edge Function |
| frontend-dev | general-purpose | page component, hooks |

### Phases
1. **Parallel build** — backend-dev + frontend-dev work simultaneously
2. **Integration** — lead merges, resolves conflicts
3. **Simplify** — code-simplifier on all modified files
4. **Verify** — browser automation on simplified code

### Handoff Contracts
- `POST /functions/v1/my-function` → `{ field: type }` → `{ field: type }`
- `my_table.new_column` (text, not null)
- `<MyComponent prop1: string, prop2: number />`
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Start local Supabase (Docker required)
npx supabase start

# Start frontend dev server
npm run dev

# Run Edge Function tests
npm run test:functions

# Build for production
npm run build
```

---

## E2E Testing
- When fixing E2E tests, always start with infrastructure-level analysis (auth flow, DB setup, parallelization) before fixing individual test assertions.
- Test selectors must account for mobile-hidden elements — prefer data-testid attributes over CSS/nav selectors.
- After modifying test files, run the full test suite (not just individual tests) to catch parallelization and shared-state issues.
- Always copy `.env.local` when creating worktrees for test environments.

---

## Git & Commits
- Before committing, ALWAYS run `git status` and `git diff --stat` to confirm ALL changed files are staged — do not assume only the files you edited are the relevant ones.
- Never use `--no-verify-jwt` or similar security-bypassing flags in production deployments without explicit user approval.

---

## Debugging Approach
- When diagnosing bugs, form 2-3 hypotheses and validate each against the code BEFORE implementing a fix. Do not implement the first hypothesis without evidence.
- If a fix doesn't resolve the issue after implementation, step back and re-examine assumptions rather than iterating on the same approach.
- For Supabase/PostgREST issues, always check: FK relationships, RLS policies, config.toml entries, and migration status.

---

## Supabase & Deployment
- Auth tokens use cookies (not localStorage) in this project — do not assume localStorage-based auth flows.
- When deploying Edge Functions, verify: function is deployed, config.toml has the entry, and all migrations are applied.
- Environment variables: use NEXT_PUBLIC_SITE_URL for client-side, SITE_URL for server-side. Clarify with user before introducing new env vars like APP_URL.

---

## Design System: Cinematic Dark

The app uses a **Cinematic Dark** theme inspired by premium streaming services and awards show aesthetics. All UI should feel like a high-end cinema experience.

### Design Tokens (defined in `globals.css` via Tailwind v4 `@theme`)

**Colors:**
| Token | Value | Usage |
|-------|-------|-------|
| `background` | `#0f0f0f` | Page backgrounds |
| `surface` | `#1c1c1c` | Card backgrounds |
| `surface-hover` | `#262626` | Hover states |
| `elevated` | `#2a2a2a` | Raised elements, inputs |
| `gold` | `#c9a227` | Primary accent, CTAs, links |
| `gold-hover` | `#d4b23a` | Gold hover state |
| `crimson` | `#a8505c` | Danger actions (muted burgundy) |
| `crimson-hover` | `#b85c68` | Crimson hover state |
| `foreground` | `#e8e8e8` | Primary text |
| `foreground-secondary` | `#b8b0a4` | Secondary text (warm gray) |
| `foreground-muted` | `#8a8078` | Muted/placeholder text (warm taupe) |
| `border` | `#2e2e2e` | Default borders |
| `border-hover` | `#404040` | Hover borders |
| `error` | `#d65c5c` | Error states (muted red) |

**Status Colors:**
- `status-setup` / `status-setup-bg` - Blue for setup phase
- `status-drafting` / `status-drafting-bg` - Yellow for drafting
- `status-active` / `status-active-bg` - Green for active
- `status-completed` / `status-completed-bg` - Gray for completed

**Feedback Colors:**
- `success` / `success-bg` - Green
- `error` / `error-bg` - Red
- `warning` / `warning-bg` - Orange
- `info` / `info-bg` - Blue

**Typography:**
- `font-display` - Montserrat (headings, titles)
- `font-body` - DM Sans (body text, default)
- `font-mono` - Geist Mono (code)

**Shadows:**
- `shadow-soft` - Subtle elevation
- `shadow-medium` - Card hover states
- `shadow-heavy` - Modals, dropdowns
- `shadow-glow-gold` - Gold glow effect for emphasis
- `shadow-glow-crimson` - Crimson glow for danger states

**Animations:**
- `animate-fade-in` - Fade in elements
- `animate-slide-up` - Slide up with fade
- `animate-glow-pulse` - Pulsing glow for "your turn" states

### Component Classes (defined in `@layer components`)

**Cards:**
```css
.card                 /* Base card: surface bg, border, rounded-lg, shadow */
.card-interactive     /* Add hover effects: lift, glow, border highlight */
```

**Buttons:**
```css
.btn                  /* Base: flex, padding, font-weight, rounded, transition */
.btn-primary          /* Gold bg, dark text - main CTAs */
.btn-secondary        /* Gold border/text, transparent bg */
.btn-danger           /* Crimson bg - destructive actions */
.btn-ghost            /* Transparent, muted text - cancel/dismiss */
```

**Form Inputs:**
```css
.input                /* Elevated bg, border, gold focus ring */
```

**Status Badges:**
```css
.badge                /* Base pill style */
.badge-setup          /* Blue */
.badge-drafting       /* Yellow */
.badge-active         /* Green */
.badge-completed      /* Gray */
```

**Alerts:**
```css
.alert                /* Base: padding, rounded, border */
.alert-error          /* Red theme */
.alert-success        /* Green theme */
.alert-warning        /* Orange theme */
.alert-info           /* Blue theme */
```

**Overlays:**
```css
.glass                /* Frosted glass effect for modals */
.modal-overlay        /* Dark backdrop with blur */
```

### Usage Guidelines

1. **Always use semantic color tokens** - Use `bg-surface` not `bg-[#1c1c1c]`
2. **Use component classes** - Use `.card` not manual `bg-surface border border-border rounded-lg`
3. **Headings use `font-display`** - Add `font-display` to h1, h2, h3 elements
4. **Gold for interactive elements** - Links, buttons, focus states
5. **Animations for state changes** - Use `animate-fade-in` for appearing content
6. **"Your turn" glow** - Use `animate-glow-pulse` with `bg-success-bg border-success`
7. **Protect async actions from double-clicks** - Use `useAsyncAction` hook for API calls

### Double-Click Protection: `useAsyncAction` Hook

**Location:** `apps/frontend/hooks/useAsyncAction.ts`

**Problem:** React's `useState` updates are batched and asynchronous. When a button triggers an API call with `disabled={isLoading}`, rapid double-clicks can both execute before the first `setIsLoading(true)` is reflected in the DOM. This causes race conditions like "It's not your turn to pick" errors.

**Solution:** The `useAsyncAction` hook uses a **ref** for synchronous, immediate protection combined with state for UI updates:

```typescript
import { useAsyncAction } from '@/hooks/useAsyncAction'

// Define the async action (must be wrapped in useCallback for stable reference)
const myAction = useCallback(async (arg1: string, arg2: number) => {
  const result = await apiCall(arg1, arg2)
  if (result.error) {
    throw new Error(result.error) // Hook stores error in `error` state
  }
  return result
}, [])

// Get the protected execute function and loading state
const { execute, isLoading, error, reset } = useAsyncAction(myAction)

// Use in JSX - second rapid click is silently ignored
<button onClick={() => execute('foo', 123)} disabled={isLoading}>
  {isLoading ? 'Saving...' : 'Save'}
</button>
{error && <p className="text-error">{error}</p>}
```

**When to use:**
- Any button that triggers an API call (draft picks, bids, trades, etc.)
- Form submissions
- Any action where duplicate requests would be harmful

**Hook returns:**
- `execute` - Protected function that silently ignores calls while already processing
- `isLoading` - Boolean for UI feedback (spinners, disabled state)
- `error` - Error message if the action threw/rejected
- `reset` - Clear the error state

**Components using this pattern:**
- `DraftBoard.tsx` - Draft picks
- `CounterpickRound.tsx` - Counterpick selections
- `PlaceBidModal.tsx` - Bid submissions
- `ProposeTradeModal.tsx` - Trade proposals
- `TradeOfferCard.tsx` - Trade actions (accept/reject/cancel/veto)
- `AcceptConfirmModal.tsx` - Trade acceptance confirmation

### File Structure

```
apps/frontend/app/
├── globals.css                    # @theme tokens, @layer base, @layer components
├── layout.tsx                     # Font imports (Montserrat, DM Sans)
├── components/                    # Shared components
│   ├── FormError.tsx              # Uses .alert-* classes
│   ├── LoadingSpinner.tsx         # Uses border-gold
│   ├── Avatar.tsx                 # User/team avatars
│   ├── CinemaNav.tsx              # Main navigation
│   └── ...                        # 15+ shared components
├── hooks/                         # Shared hooks
│   ├── useAsyncAction.ts          # Double-click protection for async actions
│   ├── useInfiniteScroll.ts
│   ├── useNotifications.ts
│   └── useScrollPosition.ts
├── utils/                         # Utilities
│   ├── date.ts                    # Date formatting
│   ├── league.ts                  # League helpers
│   └── supabase/                  # Supabase clients
└── (authenticated)/league/[id]/
    ├── components/                # 22 league-specific components
    └── hooks/                     # useDraftMovies, useBidding
```

---

## 1. High-Level Architecture

**Direct Supabase + Edge Functions** — no separate backend service. Simple CRUD uses Supabase client directly (with RLS); complex operations (drafting, scoring, external APIs) use Edge Functions. Cron jobs run via Vercel Cron → Edge Function.

| Use Case | Approach |
|----------|----------|
| Auth, session management | Direct Supabase |
| List leagues, teams, standings | Direct Supabase |
| Real-time updates (draft board, leaderboard) | Supabase Realtime |
| Complex validation (draft picks, bids, trades) | Edge Function |
| External APIs (TMDb, MDBList) | Edge Function |
| Scheduled jobs (scoring, bid processing) | Vercel Cron → Edge Function |

---

## 2. Core Data Model

### Tables

- **User:** Managed by Supabase Auth (`auth.users`)
- **profiles:** id, user_id, display_name, avatar_url, discord_id, discord_username (extends auth.users)
- **leagues:** id, name, owner_id, invite_only, draft config, status
- **league_participants:** id, league_id, user_id, role, status
- **league_bidding_config:** league_id, bidding_enabled, bidding_start_date, bidding_end_date, min_bid, max_bid
- **teams:** id, participant_id, name, avatar_url, faab_budget
- **movies:** id, tmdb_id, title, release_date, poster_url, status, imdb_id
- **draft_picks:** id, league_id, team_id, movie_id, pick_order, round, picked_at
- **pickup_bids:** id, league_id, team_id, movie_id, bid_amount, status, created_at, processed_at
- **trades:** id, league_id, proposer_team_id, recipient_team_id, status, proposed_at, resolved_at
- **trade_items:** id, trade_id, team_id, movie_id
- **reviews:** id, movie_id, source, score, fetched_at
- **team_scores:** id, team_id, total_points, last_updated
- **invitations:** id, league_id, invited_by, email, token, status, sent_at

### Key Relationships

`auth.users` → `profiles` (1:1) → `league_participants` (1:N) → `teams` (1:1 per league) → `draft_picks`/`pickup_bids`/`trades`/`team_scores`. Movies have reviews (1:N). Leagues have bidding config (1:1).

---

## 3. Tech Stack & Local Development

- **Frontend:** Next.js 15 + React 19 + Tailwind CSS 4
- **Auth:** Supabase Auth (JWT tokens, email/password, Discord OAuth)
- **Backend:** Supabase Edge Functions (Deno runtime)
- **Database:** Supabase PostgreSQL with RLS
- **Storage:** Supabase Storage (avatars)
- **Real-time:** Supabase Realtime subscriptions
- **Jobs:** Vercel Cron → Edge Function for scoring and bid processing
- **Movie Data:** TMDb (upcoming, search, details) + MDBList (reviews/scores)
- **Email:** Supabase (built-in email auth) + Resend (transactional, bid notifications)
- **Deployment:** Vercel (frontend) + Supabase (backend/DB)

### Local Development Environment

**IMPORTANT:** This project uses **local Supabase** for development (not hosted Supabase).

```bash
# Start local Supabase (Docker required)
npx supabase start

# Local Supabase URLs (default)
# API: http://127.0.0.1:54321
# Studio: http://127.0.0.1:54323
# DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Stop local Supabase
npx supabase stop
```

Environment variables for local development are in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` - Local Supabase API URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Local anon key
- `TMDB_API_KEY` - TMDb API key (required for movie search/browse)
- `MDBLIST_API_KEY` - MDBList API key (required for score updates)

### Supabase Database Commands

**CRITICAL: Understand these commands before running them to avoid data loss!**

| Command | Effect | Data Loss? | When to Use |
|---------|--------|------------|-------------|
| `npx supabase migration up` | Applies only NEW/pending migrations | **No** | Adding new tables, columns, or policies |
| `npx supabase db push` | Pushes local schema changes to DB | **No** | Syncing schema without full reset |
| `npx supabase db reset` | **DESTROYS ALL DATA**, re-runs all migrations from scratch | **YES - TOTAL** | Only when you need a fresh start or schema is corrupted |
| `npx supabase db reset --no-seed` | Same as above but skips seed.sql | **YES - TOTAL** | Fresh start without seed data |

**Best Practices:**
1. **Always use `migration up`** when adding new migrations - it preserves existing data
2. **Never use `db reset`** unless you explicitly want to wipe all data (users, leagues, etc.)
3. **Create a backup** before any destructive operation: `npx supabase db dump -f backup.sql`
4. **Use seed.sql** for test data you want restored after resets

**Example - Safe workflow for new migrations:**
```bash
# Create a new migration file
npx supabase migration new my_new_feature

# Edit the migration file in supabase/migrations/

# Apply ONLY the new migration (preserves data)
npx supabase migration up

# Verify it worked
npx supabase db diff
```

**Example - When you DO need a reset:**
```bash
# Backup first (optional but recommended)
npx supabase db dump -f backup_$(date +%Y%m%d).sql

# Reset database (ALL DATA WILL BE LOST)
npx supabase db reset

# Re-register test users at /signup
```

### Deploying Edge Functions to Production

**CRITICAL: New Edge Functions require config.toml entry to work in production!**

Due to an [ES256 JWT verification bug in Supabase CLI](https://github.com/supabase/cli/issues/4453), all Edge Functions in this project must have `verify_jwt = false` in `config.toml`. Functions handle auth internally via `supabase.auth.getUser()`.

**Checklist for deploying a new Edge Function:**

1. **Add to `config.toml`** (required for production):
   ```toml
   [functions.my-new-function]
   verify_jwt = false
   ```

2. **Deploy the function:**
   ```bash
   npx supabase functions deploy my-new-function
   ```

3. **Push any related migrations:**
   ```bash
   npx supabase db push
   ```

**Common error if you skip step 1:** `{"code":401,"message":"Invalid JWT"}` even with valid auth token.

### RLS Best Practices

When writing or modifying Row Level Security policies, follow these patterns for optimal performance:

**1. Wrap auth functions in subqueries:**
```sql
-- GOOD: Evaluated once per query
WHERE user_id = (SELECT auth.uid())

-- BAD: Re-evaluated for every row
WHERE user_id = auth.uid()
```

**2. Add `TO authenticated` role to user-facing policies:**
```sql
-- GOOD: Skips evaluation for anonymous users
CREATE POLICY "..." ON table FOR SELECT TO authenticated USING (...)

-- BAD: Runs for all roles including anon
CREATE POLICY "..." ON table FOR SELECT USING (...)
```

**3. Use security definer helper functions for:**
- Breaking RLS recursion cycles (table A policy queries table B, table B policy queries table A)
- Reusable membership/ownership checks
- See `is_league_member()`, `is_league_owner()`, `is_team_owner()` in migrations

**4. Add supporting indexes:**
- Expression indexes for transformed columns: `CREATE INDEX ... ON table(LOWER(email))`
- Partial indexes for common filters: `CREATE INDEX ... ON table(col) WHERE status = 'active'`

Reference: https://supabase.com/docs/guides/database/postgres/row-level-security

### PostgREST Ambiguous Relationships

When a table has **multiple foreign keys to the same target table**, PostgREST cannot determine which relationship to use and returns error `PGRST201`. You must explicitly specify the FK constraint name.

**Tables with multiple FKs to `teams`:**
| Table | FK Columns | Use Case |
|-------|------------|----------|
| `draft_picks` | `team_id`, `counterpicked_by_team_id` | Team that drafted vs team that counterpicked |
| `trade_offers` | `initiator_team_id`, `recipient_team_id` | Trade proposer vs recipient |
| `trade_assets` | `from_team_id`, `to_team_id` | Asset source vs destination |
| `counterpicks` | `counterpicker_team_id`, `target_team_id` | Who counterpicked vs whose movie |

**Fix pattern:**
```typescript
// BAD: Ambiguous - returns PGRST201 error
.select(`*, teams (*)`)

// GOOD: Explicit FK constraint name
.select(`*, teams!draft_picks_team_id_fkey (*)`)
```

**Finding FK constraint names:**
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'draft_picks'::regclass AND contype = 'f';
```

---

## 4. Remaining Work

- ⬜ Production deployment configuration
- ⬜ End-to-end tests (Playwright)
- ⬜ Mobile-responsive polish

---

## 5. Scoring System

### Fantasy Points Curve

Movies earn fantasy points from their Rotten Tomatoes Tomatometer score alone, using a baseline-relative curve (baseline 60 = RT's own "Fresh" line):

**Formula Tiers:**
| RT Score | Calculation |
|----------|-------------|
| 90+ | 30 + 2 pts per point above 90 ("The 90% Club") |
| 50-89 | RT − 60 |
| 40-49 | −10 − 0.5 pts per point below 50 |
| 30-39 | −15 − 0.25 pts per point below 40 |
| 20-29 | −17.5 − 0.125 pts per point below 30 |
| 10-19 | −18.75 − 0.0625 pts per point below 20 |
| Below 10 | −19.375 − 0.03125 pts per point below 10 |

Below 50, the slope halves every 10 points, so penalties approach an asymptote around -20 with no hard floor.

**Examples:**
- 96% → **+42 pts** (30 + 2×6)
- 84% → **+24 pts** (84−60)
- 60% → **0 pts** (baseline)
- 35% → **-16.25 pts** (-15 − 0.25×5)

### Data Sources
- **Rotten Tomatoes (Tomatometer):** The only source that drives `fantasy_points`. Stored as `movies.combined_score`.
- **IMDb / Metacritic:** Still fetched from MDBList and stored in `reviews` for display context; they no longer affect scoring.

### Score Sync
- Nightly cron job fetches latest scores from MDBList
- Only updates movies that have been released
- Recalculates fantasy points and team totals after each sync
- A movie with no RT score yet is unscored (`combined_score` and `fantasy_points` are `NULL`, shown as "Pending")
- See `supabase/SCORING.md` for full architecture details

---

## 6. Draft System

### Draft Configuration
- **Draft Type:** Snake draft (1-2-3...3-2-1) or Linear (1-2-3...1-2-3)
- **Rounds:** Configurable per league (default: 5)
- **Time Limit:** Optional per-pick timer
- **Auto-pick:** If timer expires, auto-select highest-rated available movie

### Draft Flow
1. League owner sets draft window (start/end dates)
2. When draft starts, status changes to 'drafting'
3. Participants take turns picking movies
4. Each movie can only be picked once per league
5. Draft ends when all rounds complete or window closes
6. League status changes to 'active'

### Movie Discovery (TMDb API-Powered)

Movies are discovered directly from TMDb API - **no pre-syncing required**.

**Data Flow:**
```
1. User opens draft board
   └── MoviePicker mounts
       └── useDraftMovies hook calls browse-movies API
           └── Returns TMDbSearchResult[] from TMDb discover

2. User searches for a movie
   └── Search input debounced (300ms)
       └── useDraftMovies calls search-movies API
           └── Returns TMDbSearchResult[] from TMDb search

3. User drafts a movie
   └── DraftBoard calls draft-pick with { league_id, tmdb_id, movie_data }
       └── Edge function:
           ├── Finds movie by tmdb_id OR
           └── Creates movie from movie_data if not exists
       └── Creates draft_pick with DB movie.id
       └── Returns success with movie details

4. UI updates via real-time subscription
   └── New pick appears in history
   └── tmdb_id added to drafted set (filtered from results)
```

**Key Types:**
- `TMDbSearchResult` - Movie data from TMDb API (has `tmdb_id: number`)
- `Movie` - Database entity (has `id: string` UUID and `tmdb_id: number`)
- `draft-pick` accepts `tmdb_id` + optional `movie_data` for find-or-create

---

## 7. Bidding System (Pickup Phase)

After the draft completes, leagues can enable a **bidding phase** where teams compete to pick up undrafted movies.

### Configuration

League owners configure bidding via `/league/[id]/settings`:
- **bidding_enabled:** Toggle bidding on/off
- **bidding_start_date / bidding_end_date:** Active window
- **min_bid / max_bid:** Bid amount constraints (optional)

### Bid Lifecycle

```
1. Team places bid on undrafted movie
   └── place-bid validates: league active, movie available, amount valid
       └── Creates pickup_bid with status='pending'
       └── Sends "outbid" email to previous high bidder (if any)

2. Other teams can counter-bid
   └── Higher bid replaces current high bid
   └── Original bidder notified via email

3. Bidding window closes OR manual processing
   └── process-bids cron job runs
       └── For each movie with bids:
           ├── Highest bid wins → status='won', draft_pick created
           └── Other bids → status='lost'
       └── Email notifications sent to all bidders
```

### Edge Functions

| Function | Purpose |
|----------|---------|
| `place-bid` | Create/update bid with validation |
| `cancel-bid` | Cancel pending bid before processing |
| `process-bids` | Resolve all pending bids (cron) |

### Frontend Components

```
/league/[id]/bidding           # Bidding page
├── BiddingPanel               # Available movies to bid on
├── BidCard                    # Individual bid display
├── PlaceBidModal              # Bid placement form
└── useBidding hook            # Bid state management
```

---

## 8. Trading System

Teams can trade movies with each other during the active season.

### Configuration

- **FAAB Budget:** Teams have a budget for bidding (Free Agent Acquisition Budget)
- **Review Period:** Optional window for league review before trades execute
- **Veto:** League owner can veto trades

### Trade Lifecycle

```
1. Team proposes trade
   └── propose-trade creates trade with status='pending'
       └── Specifies movies from each side

2. Recipient responds
   └── respond-trade: accept, reject, or counter
       └── Accept → trade executes (draft_picks updated)
       └── Reject → trade cancelled
       └── Counter → new counter-offer created

3. Counter-offers
   └── counter-trade modifies the proposal
       └── Original proposer can accept/reject/counter

4. Processing
   └── process-trades cron handles expired trades
       └── Pending trades past deadline → cancelled
```

### Edge Functions

| Function | Purpose |
|----------|---------|
| `propose-trade` | Create trade proposal |
| `respond-trade` | Accept or reject trade |
| `counter-trade` | Counter-offer on trade |
| `cancel-trade` | Cancel pending trade |
| `veto-trade` | League owner vetoes trade |
| `get-trades` | List trades for league |
| `process-trades` | Process pending/expired trades (cron) |

---

## 9. Testing Strategy

### Edge Functions Testing (Deno)

Edge Functions use **Deno's native testing framework**. Tests are located alongside each function.

#### Test Structure
```
supabase/functions/
├── deno.json                    # Test config with imports
├── _test_utils/
│   ├── mocks.ts                 # Mock Supabase client & utilities
│   └── fixtures.ts              # Test data fixtures (valid UUIDs!)
├── _shared/
│   ├── utils.ts
│   ├── utils.test.ts            # Shared utility tests
│   └── email.test.ts            # Email module tests
├── tests/                       # Integration tests (14+ files)
│   ├── _setup.ts                # Test utilities, auth helpers
│   ├── create-league.test.ts
│   ├── join-league.test.ts
│   ├── draft-pick.test.ts
│   └── ...                      # More test files
└── [function-name]/
    └── index.ts
```

#### Running Tests
```bash
# From project root
npm run test:functions

# Or directly (requires Deno installed)
cd supabase/functions && deno task test

# Watch mode
npm run test:functions:watch
```

#### Writing Tests

**1. Use the mock utilities:**
```typescript
import { createMockSupabaseClient, createMockAuthRequest, mockEnvVars } from '../_test_utils/mocks.ts'
import { mockUser, mockLeague } from '../_test_utils/fixtures.ts'

// Configure mock responses
const mockConfig = {
  user: mockUser,
  tables: {
    leagues: {
      select: { data: mockLeague, error: null },
      insert: { data: mockLeague, error: null },
    },
  },
  rpc: {
    get_next_draft_pick: { data: [mockNextPickInfo], error: null },
  },
}
const mockClient = createMockSupabaseClient(mockConfig)
```

**2. Test categories to cover:**
- Authentication (401 responses)
- Input validation (400 responses)
- Authorization (403 responses)
- Business logic (turn validation, capacity checks)
- Success paths (201/200 responses)
- Error handling (500 responses, race conditions)

**3. Important: Use valid UUID format (8-4-4-4-12 hex chars):**
```typescript
// CORRECT
const validId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// WRONG - will fail isValidUUID()
const invalidId = 'league-uuid-1234-5678-90ab-cdef12345678'
```

### Integration Tests

Integration tests run against actual local Supabase instance:

```bash
# Run integration tests (requires local Supabase running)
npm run test:functions:integration

# Run specific test file
cd supabase/functions && deno test tests/create-league.test.ts
```

---

## 10. Known Issues & Technical Debt

### Medium Priority
1. **CORS:** Currently allows all origins (`*`). Should restrict in production.
2. **get-leagues:** No pagination for large league lists.
3. **update-scores:** 50 movie limit per batch is conservative.

### Low Priority
4. **Input validation:** Missing validation for draft dates, max_participants bounds.
5. **Error messages:** Some are generic, could be more specific for debugging.
6. **Frontend tests:** No unit tests yet. E2E tests in progress.

---

## 11. Additional Documentation

| File | Purpose |
|------|---------|
| `docs/OAUTH.md` | Discord OAuth setup instructions |
| `docs/PLAN-account-linking.md` | Account linking design document |
| `docs/archive/TRADING_TECH_DEBT_RESOLVED.md` | Historical trading system fixes |
| `supabase/SCORING.md` | Nightly score update architecture |
| `supabase/functions/TESTING.md` | Edge Function testing guide |
| `supabase/README.md` | Supabase local development setup |

---

End of Developer Context
