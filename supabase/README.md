# Supabase Local Development

This directory contains the Supabase configuration, migrations, and seed data for Fantasy Reel.

## Quick Start

```bash
# Start local Supabase (requires Docker)
npx supabase start

# Reset database with seed data
npx supabase db reset

# Stop local Supabase
npx supabase stop
```

## Test Seed Data

The `seed.sql` file provides comprehensive test data for local development. After running `npx supabase db reset`, you'll have:

### Test Users

All users have the password: `testpass123!`

| User | Email | Description |
|------|-------|-------------|
| Alice Spielberg | alice@fantasyreel.test | Owns 2 leagues, active in 3 |
| Bob Nolan | bob@fantasyreel.test | Owns 1 league, member of 2 |
| Carol Coppola | carol@fantasyreel.test | Owns 1 league, member of 2, has pending invite |
| Dave Kubrick | dave@fantasyreel.test | Member of 1 league |
| Eve Tarantino | eve@fantasyreel.test | Has pending invitation (test join flow) |
| Frank Scorsese | frank@fantasyreel.test | No leagues (test empty state) |

### Test Scenarios

#### 1. Blockbuster League (DRAFTING)
- **Owner:** Alice
- **Members:** Alice, Bob, Carol, Dave (4 teams)
- **State:** Mid-draft with 12 picks made (3 rounds complete)
- **Test cases:**
  - Draft board UI with real-time updates
  - Snake draft turn calculation
  - Pick history display
  - "Your turn" indicators

#### 2. Oscar Contenders (ACTIVE)
- **Owner:** Alice
- **Members:** Alice, Bob, Carol (3 teams)
- **State:** Draft complete, movies released with scores
- **Test cases:**
  - Leaderboard and standings
  - Team score calculations
  - Movie review display
  - Completed draft view

#### 3. Summer Blockbusters (SETUP)
- **Owner:** Bob
- **Members:** Bob only
- **Invitations:** 4 (pending, expired, declined)
- **Test cases:**
  - League setup flow
  - Sending invitations
  - Invitation states (pending, expired, declined)
  - Join via invitation token

#### 4. Completed Season 2024 (COMPLETED)
- **Owner:** Carol
- **Members:** Carol, Alice (2 teams)
- **State:** Season finished with final scores
- **Test cases:**
  - Completed league display
  - Final standings
  - Historical data view

### Data Summary

| Entity | Count | Notes |
|--------|-------|-------|
| Users | 6 | All with verified emails |
| Leagues | 4 | One in each status |
| Participants | 10 | Various roles |
| Teams | 10 | Custom names |
| Movies | 30 | 15 upcoming, 15 released |
| Draft Picks | 37 | Snake draft order |
| Reviews | 45 | 3 sources per released movie |
| Team Scores | 5 | For active/completed leagues |
| Invitations | 4 | Mixed statuses |

### Testing Specific Flows

**Login as different users:**
```
alice@fantasyreel.test  → See multiple leagues, active drafting
bob@fantasyreel.test    → Own a league in setup, manage invitations
carol@fantasyreel.test  → See pending invitation on dashboard
eve@fantasyreel.test    → Accept invitation flow
frank@fantasyreel.test  → Empty dashboard state
```

**Test invitation flow:**
1. Login as Eve (`eve@fantasyreel.test`)
2. Dashboard shows pending invitation to "Summer Blockbusters"
3. Accept invitation to join the league

**Test draft board:**
1. Login as Alice (`alice@fantasyreel.test`)
2. Navigate to "Blockbuster League"
3. Draft board shows mid-draft state with pick history

## Database Commands

| Command | Effect | Data Loss? |
|---------|--------|------------|
| `npx supabase migration up` | Apply pending migrations | No |
| `npx supabase db reset` | Drop all, re-run migrations + seed | Yes |
| `npx supabase db reset --no-seed` | Reset without seed data | Yes |

## Movie Scoring System

Fantasy Reel automatically fetches and calculates movie scores using a three-layer architecture:

1. **Queue (pgmq)** - Movies needing score updates are queued daily
2. **Scheduler (pg_cron)** - Processes queue in batches every minute
3. **Worker (Edge Function)** - Fetches scores from MDBList, stores in database

Scores are a weighted average of:
- IMDb (35%) + Rotten Tomatoes (40%) + Metacritic (25%)

See **[SCORING.md](./SCORING.md)** for complete documentation including:
- Architecture diagrams
- Score calculation formula
- Configuration and troubleshooting
- Manual operations

## Directory Structure

```
supabase/
├── config.toml          # Supabase local config
├── seed.sql             # Test data (applied after migrations)
├── SCORING.md           # Movie scoring system documentation
├── migrations/          # Database migrations
│   ├── 20250706_*.sql   # Initial tables
│   ├── 20250707_*.sql   # Remaining tables
│   ├── 20260115_*.sql   # Movie scoring system
│   └── ...
└── functions/           # Edge Functions
    ├── _shared/         # Shared utilities
    ├── create-league/
    ├── draft-pick/
    ├── process-movie-scores/  # Score update worker
    └── ...
```

## Local URLs

After `npx supabase start`:

| Service | URL |
|---------|-----|
| API | http://127.0.0.1:54321 |
| Studio | http://127.0.0.1:54323 |
| Mailpit | http://127.0.0.1:54324 |
| Database | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
