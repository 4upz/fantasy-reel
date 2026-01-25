Fantasy Movies App Proof-of-Concept Plan

This document provides the context, requirements, architecture, and recommended proof-of-concept stack for an LLM coding agent to begin co-piloting development of the Fantasy Movies web application.

---

## Development Workflow

**IMPORTANT: After completing each implementation step, BEFORE committing:**

1. Run the `code-simplifier:code-simplifier` agent on the recently modified code
2. The agent will review and refactor for clarity, consistency, and reduced duplication
3. Verify tests still pass after simplification
4. Then commit the changes

This ensures all code is refined and maintainable before being committed to the repository.

**UI/Frontend Changes:**

When implementing any UI changes, new components, or frontend features, **always invoke the `frontend-design` skill first** using `/frontend-design` or the Skill tool. This skill ensures:
- Consistent application of the Cinematic Dark design system
- High-quality, distinctive UI that avoids generic "AI slop" aesthetics
- Proper use of design tokens, component classes, and animations
- Production-grade, polished implementation

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

## 1. Project Overview

**Goal:** Build a proof-of-concept web application that allows users to create fantasy leagues for movies, draft upcoming releases, and score based on aggregated review data (IMDb, Rotten Tomatoes, Metacritic).

**Core Flow:**
1. User signs up / logs in.
2. User creates or joins a League.
3. Each League member creates a Production Company (team).
4. Teams draft movies from the current year's upcoming releases.
5. Once movies release, a background job fetches review scores and computes points.
6. Leaderboard updates in real time or via periodic polling.

---

## 2. Functional Requirements

- **League Management:** create, invite, join, configure (open vs. invite-only); invitation links.
- **Team (Production Company):** one team per league participant; customizable name and avatar.
- **Movie Drafting:** snake or simple pick order; enforce one pick per movie; rounds.
- **Pickup Bidding:** post-draft phase where teams bid on undrafted movies; highest bid wins.
- **Data Source:**
  - Metadata: TMDb for upcoming list, posters, release dates.
  - Reviews: OMDb or a paid aggregator for IMDb/RT/Metacritic scores.
- **Scoring Engine:** nightly job to fetch and normalize review scores; update each team's total points.
- **Dashboard & Standings:** per-league and per-team views, with movie release schedule and current points.
- **Notifications:** email for invitations, draft reminders, bid updates, and movie releases.
- **Auth & Permissions:** Email/password or Discord OAuth; account linking; role checks (owner, member).

---

## 3. Non-Functional Requirements

- **API-First:** REST endpoints via Supabase Edge Functions for complex business logic.
- **Mobile-Ready:** Architecture supports future native mobile apps using same backend APIs.
- **Scalability:**
  - Start serverless (Vercel) and managed services.
  - Direct Supabase calls for simple CRUD; Edge Functions for complex operations.
  - Supabase handles scaling automatically; add read replicas if needed.
- **Speed-to-Market:** leverage managed auth (Supabase Auth), managed database (Supabase), a PaaS for deployment.
- **Maintainability:** structured code, modular Edge Functions, Supabase migrations, unit/integration tests.
- **Security:** JWT validation via Supabase, RLS policies, atomic draft transactions.

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                              │
│                    (Web / Mobile)                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Supabase   │    │  Supabase   │    │  Supabase   │
│    Auth     │    │   Edge      │    │  Real-time  │
│             │    │  Functions  │    │             │
│ Login/JWT   │    │             │    │ Leaderboard │
│ Signup      │    │ Draft picks │    │ Draft board │
│ Sessions    │    │ Movie sync  │    │ Live scores │
│             │    │ Scoring job │    │             │
└─────────────┘    └──────┬──────┘    └──────┬──────┘
                          │                  │
                          ▼                  ▼
                   ┌─────────────────────────────┐
                   │     Supabase PostgreSQL     │
                   │    + Row Level Security     │
                   └─────────────────────────────┘
                                 ▲
                                 │
                   ┌─────────────────────────────┐
                   │    External Movie APIs      │
                   │    (TMDb / OMDb)            │
                   └─────────────────────────────┘
```

### Architecture Decision: Direct Supabase + Edge Functions

**Why this approach over NestJS:**
- Faster development velocity for POC
- No separate backend service to host/deploy
- Edge Functions handle complex logic (drafting, scoring, external APIs)
- Direct Supabase calls for simple CRUD operations
- Real-time subscriptions built-in for leaderboards
- Can add NestJS later if complexity warrants it

**When to use each approach:**

| Use Case | Approach |
|----------|----------|
| Auth, session management | Direct Supabase |
| List leagues, teams, standings | Direct Supabase |
| Real-time updates (draft board, leaderboard) | Supabase Realtime |
| Create/join league with validation | Edge Function |
| Make a draft pick (atomic transaction) | Edge Function |
| Place/cancel pickup bids | Edge Function |
| Process bids (resolve winners) | Vercel Cron → Edge Function |
| Sync movies from TMDb | Edge Function |
| Nightly scoring job | Vercel Cron → Edge Function |
| Fetch review scores from OMDb | Edge Function |
| Account linking/merging | Edge Function |

---

## 5. Core Data Model

### Tables

- **User:** Managed by Supabase Auth (`auth.users`)
- **profiles:** id, user_id, display_name, avatar_url, discord_id, discord_username (extends auth.users)
- **leagues:** id, name, owner_id, invite_only, draft config, status
- **league_participants:** id, league_id, user_id, role, status
- **league_bidding_config:** league_id, bidding_enabled, bidding_start_date, bidding_end_date, min_bid, max_bid
- **teams:** id, participant_id, name, avatar_url
- **movies:** id, tmdb_id, title, release_date, poster_url, status, imdb_id
- **draft_picks:** id, league_id, team_id, movie_id, pick_order, round, picked_at
- **pickup_bids:** id, league_id, team_id, movie_id, bid_amount, status, created_at, processed_at
- **reviews:** id, movie_id, source, score, fetched_at
- **team_scores:** id, team_id, total_points, last_updated
- **invitations:** id, league_id, invited_by, email, token, status, sent_at

### Relationships

```
auth.users (Supabase managed)
    │
    ├── profiles (1:1, includes Discord OAuth fields)
    │
    ├── leagues (1:N as owner)
    │       │
    │       └── league_bidding_config (1:1)
    │
    └── league_participants (1:N)
            │
            └── teams (1:1 per league)
                    │
                    ├── draft_picks (1:N)
                    │       │
                    │       └── movies (N:1)
                    │               │
                    │               └── reviews (1:N)
                    │
                    ├── pickup_bids (1:N)
                    │
                    └── team_scores (1:1)
```

---

## 6. API Endpoint Sketch

### Direct Supabase (via client SDK)
```
# Simple CRUD - use Supabase client directly
GET    leagues (with RLS filtering)
GET    teams (with RLS filtering)
GET    movies
GET    standings/leaderboard
SUBSCRIBE  realtime:leagues, realtime:draft_picks
```

### Edge Functions (complex operations)
```
# League Management
POST   /functions/v1/create-league      # Create league + add owner as participant
POST   /functions/v1/update-league      # Update league configuration/settings
POST   /functions/v1/join-league        # Validate + add participant
GET    /functions/v1/get-leagues        # List user's leagues

# Invitations
POST   /functions/v1/send-invite        # Create invitation + send email
POST   /functions/v1/resend-invitation  # Resend invitation email with new token
POST   /functions/v1/cancel-invitation  # Cancel a pending invitation
POST   /functions/v1/decline-invitation # Decline an invitation
GET    /functions/v1/search-users       # Search users to invite

# Draft
POST   /functions/v1/start-draft        # Transition league status to 'drafting'
POST   /functions/v1/draft-pick         # Atomic: validate turn, check availability, record pick
POST   /functions/v1/drop-movie         # Team drops a drafted movie

# Bidding (Pickup Phase)
POST   /functions/v1/place-bid          # Place or update a pickup bid
POST   /functions/v1/cancel-bid         # Cancel an active bid
POST   /functions/v1/process-bids       # Auto-process won/lost bids (cron job)

# Movies
GET    /functions/v1/browse-movies      # Browse upcoming movies via TMDb discover
GET    /functions/v1/search-movies      # Search movies via TMDb search API
GET    /functions/v1/get-movie-details  # Get detailed movie info from TMDb
POST   /functions/v1/sync-movies        # Fetch from TMDb, upsert to DB
POST   /functions/v1/update-scores      # Fetch reviews, calculate points (cron job)
POST   /functions/v1/process-movie-scores # Process queued movies for scoring

# Account Management
POST   /functions/v1/merge-accounts     # Merge OAuth account with existing account
```

### Frontend Auth (Supabase)
- Login/Register: Handled by Supabase Auth
- JWT Token: Automatically included in Supabase client requests
- Email verification: Handled by Supabase

---

## 7. Recommended POC Stack

- **Frontend:** Next.js 15 + React 19 + Tailwind CSS 4
- **Auth:** Supabase Auth (JWT tokens, email/password, Discord OAuth)
- **Backend:** Supabase Edge Functions (Deno runtime)
- **Database:** Supabase PostgreSQL with RLS
- **Storage:** Supabase Storage (avatars)
- **Real-time:** Supabase Realtime subscriptions
- **Jobs:** Vercel Cron → Edge Function for scoring and bid processing
- **Movie Data:** TMDb (upcoming, search, details) + OMDb (reviews)
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
- `OMDB_API_KEY` - OMDb API key (required for score updates)

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

---

## 8. Implementation Progress

### Completed
1. ✅ Initialize Repo: monorepo with npm workspaces
2. ✅ Configure Supabase Auth: client utilities, middleware, login/signup/dashboard pages
3. ✅ Create leagues table with RLS policies
4. ✅ Basic league creation and listing UI
5. ✅ Define Database Schema: all tables (participants, teams, movies, drafts, reviews, scores, invitations)
6. ✅ Implement Edge Functions for league operations:
   - `create-league` - Creates league + owner participant + team
   - `join-league` - Join via invitation token or direct (open leagues)
   - `send-invite` - Create invitation + send email via Resend
   - `resend-invitation` - Resend invitation email with new token
   - `draft-pick` - Atomic draft picks with turn validation, accepts `tmdb_id` with find-or-create
   - `sync-movies` - Fetch upcoming movies from TMDb (includes IMDb IDs)
   - `update-scores` - Fetch reviews from OMDb, normalize scores, update team totals
   - `get-leagues` - List user's leagues
   - `start-draft` - Transition league from setup to drafting status
   - `browse-movies` - Browse upcoming movies via TMDb discover API (with filters)
   - `search-movies` - Search movies via TMDb search API
   - `get-movie-details` - Get detailed movie info including cast from TMDb
7. ✅ Unit test suite for all Edge Functions (100+ tests, 100% pass)
8. ✅ Build league detail page with draft board:
   - `/league/[id]` - Server component with data fetching
   - `LeagueDetailClient` - Client component with real-time subscriptions
   - `DraftBoard` - Snake draft turn calculation, pick history
   - `MoviePicker` - Search and select available movies
   - `ParticipantsList` - Teams with draft order display
   - `LeagueHeader` - Status, invite button, start draft button
   - `InviteModal` - Send invitations with shareable link
9. ✅ Connect frontend to Edge Functions:
   - `LeagueManager` now uses `create-league` Edge Function
   - League cards navigate to detail page
   - Draft picks use `draft-pick` Edge Function
   - Invitations use `send-invite` Edge Function
10. ✅ Implement real-time subscriptions for draft board:
    - Enabled Supabase Realtime for `leagues`, `draft_picks`, `league_participants`
    - Frontend subscribes to postgres_changes for live updates
11. ✅ Join league flow:
    - `/join` page for accepting invitations via token
    - Calls `join-league` Edge Function
    - Redirects to league detail on success
12. ✅ Resend confirmation email flow:
    - `resendConfirmationEmail` server action using Supabase `auth.resend()`
    - Login page shows resend button when email is unconfirmed
    - `/auth/auth-code-error` page converted to resend form for expired links
    - Security: never reveals email existence, uses Supabase rate limiting
13. ✅ TMDb API-powered movie drafting:
    - Replaced pre-synced DB movies with direct TMDb API integration
    - `browse-movies` Edge Function for discovering upcoming movies
    - `useDraftMovies` hook for search/browse with pagination and debouncing
    - `MoviePicker` refactored to use TMDb API instead of local DB
    - `draft-pick` updated to accept `tmdb_id` with find-or-create logic
    - Movies are only saved to DB when drafted (no pre-sync required)
14. ✅ Email integration with Resend:
    - Shared email module (`_shared/email.ts`) with Resend API integration
    - Cinematic Dark themed HTML email templates
    - `send-invite` and `resend-invitation` now send actual emails
    - Security hardening: header injection protection, input validation
    - Non-blocking: email failures don't block invitation creation
    - See `EMAIL_SETUP.md` for configuration instructions

15. ✅ Leaderboard/standings page:
    - `/league/[id]/standings` - Server component with data fetching
    - `StandingsClient` - Client component with real-time subscriptions
    - `TeamStandingCard` - Expandable team ranking cards with gold/silver/bronze badges
    - `MovieScoreCard` - Movie display with poster, title, and combined score
    - `ScoreSourceBadge` - Color-coded IMDb (yellow), RT (red), Metacritic (green)
    - Team rankings sorted by total_points with tie handling (T1, T2)
    - Tab navigation between Draft and Standings views
    - Real-time subscriptions for `team_scores` and `movies` tables
    - Shared utilities extracted to `utils/league.ts`

16. ✅ Nightly score updates via Supabase pg_cron:
    - `queue-movies-for-scoring` - Daily at midnight UTC, queues released movies
    - `process-score-queue` - Every minute, processes batches of 5 via Edge Function
    - Three-layer architecture: pgmq queue → pg_cron scheduler → Edge Function worker
    - See `supabase/SCORING.md` for full documentation

17. ✅ Discord OAuth integration:
    - Discord as OAuth provider via Supabase Auth
    - `DiscordLoginButton` component with branded styling
    - `/auth/callback` handles OAuth redirect flow
    - Profile auto-populated with Discord username/avatar
    - See `docs/OAUTH.md` for setup instructions

18. ✅ Account linking and merging:
    - `/auth/link-account` page for linking OAuth to existing account
    - `merge-accounts` Edge Function for account consolidation
    - Handles duplicate detection (same email, different auth providers)
    - Profile data merged during account link
    - See `docs/PLAN-account-linking.md` for design

19. ✅ League settings/configuration UI:
    - `/league/[id]/settings` - Full league management page
    - `LeagueInfoSection` - Edit name, description, visibility
    - `DraftConfigSection` - Configure draft type, rounds, dates
    - `BiddingConfigSection` - Enable/configure bidding phase
    - `ParticipantsSection` - Manage members, kick participants
    - `DangerZoneSection` - Delete league with confirmation
    - Owner-only access via RLS and UI guards

20. ✅ Pickup bidding system:
    - Complete bid lifecycle: place → counter → process → notify
    - `place-bid` / `cancel-bid` Edge Functions with validation
    - `process-bids` cron job for auto-resolution
    - Email notifications: outbid, bid won, bid lost
    - `/league/[id]/bidding` - Dedicated bidding interface
    - `BiddingPanel`, `BidCard`, `PlaceBidModal` components
    - `useBidding` hook for state management
    - See Section 11 "Bidding System" for full details

21. ✅ League dashboard redesign:
    - Multi-tab layout: Dashboard, Draft, Bidding, Standings, Roster, Settings
    - `/league/[id]/dashboard` - Team overview with stats
    - `TeamHeader` - Team name, avatar, points display
    - `MovieTimeline` - Horizontal scroll of upcoming releases
    - `StandingsSidebar` - Compact league standings
    - `MovieGrid` - Team's drafted movies display
    - Shared layout with `LeagueTabs` navigation

22. ✅ User settings and avatar upload:
    - `/settings` - User account management page
    - `AvatarUpload` component with Supabase Storage
    - `ConnectedAccounts` - View/manage OAuth connections
    - Avatar bucket with RLS policies for secure uploads

23. ✅ Movie browsing and roster pages:
    - `/movies` - Browse all movies with filters
    - `/league/[id]/roster` - Team's movie collection
    - `MovieFilters` - Genre, date range, status filters
    - `MovieDetailModal` - Full movie info with cast
    - Infinite scroll pagination

24. ✅ Integration test suite:
    - 14+ integration tests in `supabase/functions/tests/`
    - Tests actual Edge Function invocation against local Supabase
    - Test utilities in `tests/_setup.ts` for auth/cleanup
    - Covers: leagues, invitations, drafting, bidding, accounts

25. ✅ RLS performance optimizations:
    - Security definer helper functions to break recursion
    - `(SELECT auth.uid())` wrapping for single evaluation
    - `TO authenticated` role targeting
    - Supporting indexes for common RLS queries
    - See migration `20260126_rls_performance_optimizations.sql`

### Next Up
26. ⬜ Production deployment configuration
27. ⬜ End-to-end tests (Playwright)
28. ⬜ Mobile-responsive polish

---

## 9. Scoring System

### Hybrid Fantasy Points

Movies earn fantasy points based on a **70-point baseline** system, not a simple average:

**Base Points:**
| Critic Score | Calculation |
|--------------|-------------|
| 90+ | +20 base + 2 pts per point above 90 |
| 70-89 | +1 pt per point above 70 |
| Below 70 | -0.5 pts per point below 70 (floor: -15) |

**Bonus Multipliers:**
| Bonus | Condition | Points |
|-------|-----------|--------|
| Certified Fresh | RT ≥ 75% | +3 |
| Critical Darling | All 3 sources ≥ 80 | +5 |
| Critical Disaster | Any source < 40 | -5 |

**Examples:**
- 92 avg, all ≥80 → +24 base + 3 CF + 5 Darling = **+32 pts**
- 82 avg, RT=78 → +12 base + 3 CF = **+15 pts**
- 70 avg → **0 pts**
- 55 avg → -7.5 base = **-8 pts**
- 32 avg, IMDb=25 → -15 floor - 5 Disaster = **-20 pts**

### Data Sources
- **IMDb:** Score out of 10, normalized to 100-point scale (35% weight)
- **Rotten Tomatoes:** Tomatometer percentage (40% weight)
- **Metacritic:** Metascore (25% weight)

### Score Sync
- Nightly cron job fetches latest scores from OMDb
- Only updates movies that have been released
- Recalculates fantasy points and team totals after each sync
- See `supabase/SCORING.md` for full architecture details

---

## 10. Draft System

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

## 11. Bidding System (Pickup Phase)

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

### Database Tables

- **pickup_bids:** id, league_id, team_id, movie_id, bid_amount, status, created_at
- **league_bidding_config:** league_id, bidding_enabled, dates, min/max constraints

### Frontend Components

```
/league/[id]/bidding           # Bidding page
├── BiddingPanel               # Available movies to bid on
├── BidCard                    # Individual bid display
├── PlaceBidModal              # Bid placement form
└── useBidding hook            # Bid state management
```

### Email Notifications

Bidding triggers three email types (via Resend):
1. **Outbid:** When someone places a higher bid
2. **Bid Won:** When your bid wins
3. **Bid Lost:** When another bid beats yours

---

## 12. Testing Strategy

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
│   ├── place-bid.test.ts
│   ├── cancel-bid.test.ts
│   ├── drop-movie.test.ts
│   ├── send-invite.test.ts
│   ├── invitation-actions.test.ts
│   ├── search-users.test.ts
│   ├── update-league.test.ts
│   ├── start-draft.test.ts
│   ├── merge-accounts.test.ts
│   └── get-leagues.test.ts
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

**2. Test handler logic directly:**
Since Edge Functions use `Deno.serve()`, tests recreate the handler logic with mocked dependencies. See existing test files for patterns.

**3. Test categories to cover:**
- Authentication (401 responses)
- Input validation (400 responses)
- Authorization (403 responses)
- Business logic (turn validation, capacity checks)
- Success paths (201/200 responses)
- Error handling (500 responses, race conditions)

**4. Important: Use valid UUID format (8-4-4-4-12 hex chars):**
```typescript
// CORRECT
const validId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// WRONG - will fail isValidUUID()
const invalidId = 'league-uuid-1234-5678-90ab-cdef12345678'
```

#### Mock Utilities Reference

| Utility | Purpose |
|---------|---------|
| `createMockSupabaseClient(config)` | Mock Supabase client with configurable responses |
| `createMockAuthRequest(body, options)` | Create Request with Authorization header |
| `createMockOptionsRequest()` | Create CORS preflight request |
| `mockEnvVars(vars)` | Mock Deno.env.get(), returns cleanup function |
| `mockFetch(responses)` | Mock global fetch for external APIs |
| `mockJsonResponse(data, status)` | Create mock Response object |

### Integration Tests

Integration tests run against actual local Supabase instance:

```bash
# Run integration tests (requires local Supabase running)
npm run test:functions:integration

# Run specific test file
cd supabase/functions && deno test tests/create-league.test.ts
```

**Test utilities in `tests/_setup.ts`:**
- `createTestUser()` - Create authenticated test user
- `getAuthenticatedClient()` - Get Supabase client with auth
- `cleanupTestData()` - Remove test data after tests
- `invokeFunction()` - Call Edge Function with auth headers

### Frontend Testing (Future)

Frontend uses Next.js 15 with React 19. Testing approach planned:
- **Unit tests:** Vitest for components/hooks
- **E2E tests:** Playwright for critical user flows

### Database Testing

For testing RLS policies and database functions:
- Use Supabase's pgTAP framework
- See: https://supabase.com/docs/guides/local-development/testing

---

## 13. Known Issues & Technical Debt

### Medium Priority
1. **CORS:** Currently allows all origins (`*`). Should restrict in production.
2. **get-leagues:** No pagination for large league lists.
3. **update-scores:** 50 movie limit per batch is conservative.

### Low Priority
4. **Input validation:** Missing validation for draft dates, max_participants bounds.
5. **Error messages:** Some are generic, could be more specific for debugging.
6. **Frontend tests:** No unit or E2E tests yet.

---

## 14. Additional Documentation

| File | Purpose |
|------|---------|
| `docs/OAUTH.md` | Discord OAuth setup instructions |
| `docs/PLAN-account-linking.md` | Account linking design document |
| `docs/PLAN-discord-oauth.md` | Discord OAuth implementation plan |
| `docs/plans/2026-01-20-bidding-system-design.md` | Bidding system architecture |
| `docs/plans/2026-01-20-bidding-system-implementation.md` | Bidding implementation details |
| `docs/plans/2026-01-21-bidding-ui-implementation.md` | Bidding UI components plan |
| `docs/plans/2026-01-22-league-dashboard-redesign.md` | Dashboard redesign spec |
| `supabase/SCORING.md` | Nightly score update architecture |
| `supabase/functions/TESTING.md` | Edge Function testing guide |
| `supabase/README.md` | Supabase local development setup |

---

End of POC Plan
