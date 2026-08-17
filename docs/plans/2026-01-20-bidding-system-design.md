# Bidding & Pickup System Design

## Overview

This design adds a flexible slot system where teams acquire movies through both drafting (pre-season) and pickups (during season via bidding). Inspired by Fantasy Critic's blind-budget bidding with the addition of guaranteed counter-bid windows.

## Slot Configuration

Leagues configure how many movies each team can have:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `total_slots` | integer | 8 | Total movies per team that count for scoring |
| `draft_slots` | integer | 5 | Movies that must be drafted (also = draft rounds) |
| `drop_limit` | integer | 2 | Max drops allowed per team per season |
| `counterbid_hours` | integer | 24 | Hours given to counter when outbid |

**Derived values:**
- `pickup_slots` = `total_slots - draft_slots` (calculated, not stored)
- Draft rounds = `draft_slots` (replaces hardcoded 5 rounds)

**Validation:**
- `draft_slots` >= 1
- `draft_slots` <= `total_slots`
- `total_slots` between 1-20

**Example configurations:**
- Casual: 6 total, 4 drafted, 2 pickups
- Standard: 10 total, 6 drafted, 4 pickups
- Heavy bidding: 12 total, 4 drafted, 8 pickups

---

## Bidding System

### Core Rules

- **Budget:** $100 fixed per team per season
- **$0 bids allowed:** Broke teams can still bid, but lose all tiebreakers
- **Tiebreaker:** Earliest bid wins when amounts are equal
- **Weekly cycle:** Bids processed Saturday 8pm (with extensions for counter-bids)

### Counter-Bid Mechanics

When someone places a higher bid:
1. Previous highest bidder is notified (email + in-app)
2. They receive a guaranteed response window (default 24h, league configurable)
3. They can place a new higher bid within that window
4. Processing waits until all counter windows close

**Anti-sniping protection:** The guaranteed window ensures no one loses a movie just because they were asleep when outbid.

### Processing Logic

**Weekly batch (Saturday 8pm):**
- Processes all movies where every bid's response deadline is before Saturday 8pm
- Highest active bid wins, others marked as lost

**Extended window processing (hourly):**
- Handles bids where counter-bidding pushed the deadline past Saturday 8pm
- Processes immediately once all windows for that movie close
- Prevents week-long waits for extended auctions

### Movie Eligibility

- Same as draft: current year or later release date
- Not yet released (can bid until reviews come in)
- Not already owned by another team in the league

---

## Dropping Movies

### Rules

1. Only pickup movies can be dropped (draft picks are permanent)
2. Movie must not be released yet
3. Team must have drops remaining

### Drop Flow

1. User drops a pickup movie
2. `pickups.dropped_at` set to current time
3. `team_drops` record created (tracks usage against limit)
4. Movie returns to pool for others to bid on
5. Pickup slot freed (team can bid on new movies)

**No refunds:** Teams do not get their bid amount back when dropping.

---

## Data Model

### New Tables

**`pickup_bids`** - Tracks all bids

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `league_id` | uuid | FK to leagues |
| `team_id` | uuid | FK to teams |
| `tmdb_id` | integer | Movie being bid on |
| `movie_data` | jsonb | Cached TMDb data for display/creation |
| `amount` | integer | Bid amount ($0-100) |
| `status` | enum | `active`, `outbid`, `won`, `lost`, `cancelled` |
| `created_at` | timestamp | When bid placed (tiebreaker) |
| `countered_at` | timestamp | When this bid was outbid |
| `response_deadline` | timestamp | When counter window expires |
| `processing_deadline` | timestamp | The Saturday 8pm this bid was due |

**`team_budgets`** - Tracks remaining budget

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `team_id` | uuid | FK to teams (unique) |
| `remaining_budget` | integer | Current balance (starts at 100) |
| `total_spent` | integer | Running total of won bids |

**`pickups`** - Movies acquired via bidding

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `league_id` | uuid | FK to leagues |
| `team_id` | uuid | FK to teams |
| `movie_id` | uuid | FK to movies |
| `bid_id` | uuid | FK to pickup_bids |
| `amount_paid` | integer | Winning bid amount |
| `picked_up_at` | timestamp | When acquired |
| `dropped_at` | timestamp | Null until dropped |

**`team_drops`** - Tracks drop usage

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `team_id` | uuid | FK to teams |
| `movie_id` | uuid | FK to movies |
| `dropped_at` | timestamp | When dropped |

**`notifications`** - In-app notifications

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to auth.users |
| `league_id` | uuid | FK to leagues |
| `type` | enum | `outbid`, `bid_won`, `bid_lost`, `pickup_available` |
| `title` | text | Short headline |
| `body` | text | Details |
| `data` | jsonb | Relevant IDs |
| `read_at` | timestamp | Null until read |
| `created_at` | timestamp | When created |

### Modified Tables

**`leagues`** - Add configuration fields:
- `total_slots` (default 8)
- `draft_slots` (default 5)
- `drop_limit` (default 2)
- `counterbid_hours` (default 24)

### Modified Functions

**`calculate_team_score()`** - Include pickups in scoring:
```sql
SELECT SUM(m.combined_score) FROM (
  SELECT movie_id FROM draft_picks WHERE team_id = $1
  UNION ALL
  SELECT movie_id FROM pickups
  WHERE team_id = $1 AND dropped_at IS NULL
) AS team_movies
JOIN movies m ON team_movies.movie_id = m.id
```

**`get_next_draft_pick()`** - Use `league.draft_slots` instead of hardcoded 5

---

## Edge Functions

### New Functions

| Function | Purpose |
|----------|---------|
| `place-bid` | Validate and create/update bid |
| `cancel-bid` | Cancel own active bid (before being outbid) |
| `drop-movie` | Drop a pickup movie |
| `process-weekly-bids` | Saturday batch processing |
| `process-extended-bids` | Hourly check for extended windows |

### `place-bid` Logic

1. Authenticate user
2. Validate:
   - League status is `active`
   - Movie eligible (current year+, not released, not owned)
   - Team has pickup slots available
   - Bid amount <= remaining budget
3. Check existing bids on this movie in this league
4. If higher than current top bid:
   - Mark old bid as `outbid`
   - Set `countered_at` and `response_deadline`
   - Send notification to outbid user
5. Insert new bid as `active`

### `process-weekly-bids` Logic (Saturday 8pm cron)

1. Find all movies with bids where all `response_deadline < Saturday 8pm`
2. For each movie:
   - Highest `active` bid wins → `status: won`
   - All others → `status: lost`
3. For winners:
   - Deduct from budget
   - Create movie record if needed
   - Create pickup record
4. Send win/loss notifications

### `process-extended-bids` Logic (hourly cron)

1. Find movies where:
   - At least one bid has `response_deadline > last Saturday 8pm`
   - AND all bids have `response_deadline < now()`
2. Process those movies immediately (same logic as weekly)

---

## Notifications

### Triggers

| Event | Type | Email | In-App |
|-------|------|-------|--------|
| Someone outbids you | `outbid` | Yes | Yes |
| Your bid wins | `bid_won` | Yes | Yes |
| Your bid loses | `bid_lost` | No | Yes |
| Movie dropped in league | `pickup_available` | No | Yes |

### Email Content

**Outbid notification:**
- Subject: "You've been outbid on [Movie Title]"
- Body: "[User] bid $X on [Movie]. You have 24 hours to counter."
- CTA: "Counter Bid" button linking to league page

**Bid won notification:**
- Subject: "[Movie Title] added to your roster"
- Body: "Your bid of $X won! [Movie] has been added to your team."

---

## UI Components Needed

### League Settings (during setup)
- Total slots input
- Draft slots input (with validation: <= total)
- Drop limit input
- Counter-bid hours dropdown (12h, 24h, 48h)

### Bidding Interface
- Movie search (same as draft)
- Bid amount input with remaining budget display
- Active bids list with status indicators
- "Cancel Bid" button for active bids

### Team Roster
- Draft picks section (permanent)
- Pickups section with "Drop" button
- "X of Y drops remaining" indicator
- Dropped movies shown grayed out

### Notifications
- Bell icon with unread count
- Dropdown showing recent notifications
- Mark as read on click

---

## Implementation Order

1. **Database migration:** New tables + league config fields
2. **Modify existing functions:** `get_next_draft_pick`, `calculate_team_score`
3. **Edge Functions:** `place-bid`, `cancel-bid`, `drop-movie`
4. **Processing jobs:** `process-weekly-bids`, `process-extended-bids`
5. **Notifications:** Table + email templates + in-app UI
6. **Frontend:** League settings, bidding UI, roster management
