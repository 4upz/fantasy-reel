# League Dashboard Redesign

**Date:** 2026-01-22
**Status:** Approved

## Problem Statement

The current league page has UX issues:
1. **Redundant tabs** — Two tab systems (LeagueHeader tabs + LeagueDetailClient tabs) create confusion
2. **Draft-centric default** — Draft board is the landing page even after drafting ends
3. **Missing context** — Users can't quickly see their team's performance, standings, or upcoming releases

## Design Goals

- Team-centric experience post-draft
- Phase-aware navigation (draft focus during drafting, dashboard focus after)
- Clean, minimal interface with actions in navigation, not cluttering the view
- Extensible navigation for future features (trading, etc.)

---

## Navigation Structure

### Unified Top Tab Bar

```
┌─────────────────────────────────────────────────────────────┐
│  🎬 League Name                                             │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Dashboard│  Draft   │ Bidding  │  Roster  │    Settings    │
└──────────┴──────────┴──────────┴──────────┴────────────────┘
```

| Tab | Purpose | Visibility |
|-----|---------|------------|
| Dashboard | Team overview + standings | Always |
| Draft | Draft board (active or history) | Always |
| Bidding | Bidding panel | Active/Completed phases only |
| Roster | Your team's full roster + drops | Always |
| Settings | League configuration | Always (owner: edit, member: read-only) |

### Phase-Aware Default Tab

| League Phase | Default Tab | Rationale |
|--------------|-------------|-----------|
| Setup | Draft | Waiting for draft, see participants |
| Drafting | Draft | Active drafting is the main event |
| Active | Dashboard | Team performance matters now |
| Completed | Dashboard | Final results view |

---

## Dashboard Layout

Two-column layout with team focus and standings context:

```
┌─────────────────────────────────────────┬───────────────────────────┐
│                                         │                           │
│  YOUR TEAM                              │  STANDINGS                │
│  ┌─────────────────────────────────┐    │                           │
│  │ 🎬 Team Name          #2  847pts│    │  1. Cinema Kings   892pts │
│  └─────────────────────────────────┘    │     Top: Dune 3 (94pts)   │
│                                         │                           │
│  MOVIE TIMELINE                         │  2. Your Team ★    847pts │
│  ───────────────────────────────────    │     Top: Avatar 4 (88pts) │
│                                         │                           │
│  Jan     Feb     Mar     Apr     May    │  3. Reel Deal      823pts │
│   │       │       │       │       │     │     Top: Mission 9 (82pts)│
│   ●───────●───────●───────◐───────○     │                           │
│  Dune 3  Avatar  Mission  Thunder June  │  4. Box Office...  801pts │
│  94pts   88pts   82pts    12 days TBD   │     Top: Thunderbolts     │
│                                         │                           │
│                                         │  ─────────────────────────│
│                                         │  View Full Standings →    │
└─────────────────────────────────────────┴───────────────────────────┘
```

### Your Team Header

- Team name (large, display font)
- Rank badge (gold/silver/bronze styling for top 3)
- Total points (prominent typography)

### Standings Sidebar (~1/3 width)

- All teams listed by rank
- Each entry shows:
  - Rank position
  - Team name
  - Total points
  - Top-scoring movie title + points
- Your team highlighted with accent color/star
- "View Full Standings →" link for detailed breakdown

---

## Movie Timeline Component

Horizontal timeline showing your season's story:

```
Past (Scored)                    Present                 Future (Upcoming)
────────────────────────────────────┼─────────────────────────────────────
    ●────────────●────────────●─────┼─────◐────────────○────────────○
    │            │            │     │     │            │            │
┌───────┐   ┌───────┐   ┌───────┐   │ ┌───────┐   ┌───────┐   ┌───────┐
│ Poster│   │ Poster│   │ Poster│   │ │ Poster│   │ Poster│   │ Poster│
│       │   │       │   │       │   │ │       │   │       │   │       │
├───────┤   ├───────┤   ├───────┤   │ ├───────┤   ├───────┤   ├───────┤
│Dune 3 │   │Avatar4│   │Miss. 9│   │ │Thunder│   │Karate │   │Tron 3 │
│94 pts │   │88 pts │   │82 pts │   │ │ 12 days│   │ 2 mo  │   │ TBD   │
└───────┘   └───────┘   └───────┘   │ └───────┘   └───────┘   └───────┘
```

### Visual States

| State | Icon | Display | Styling |
|-------|------|---------|---------|
| Scored | ● (filled) | Points earned | Slightly muted (past) |
| Releasing Soon | ◐ (half) | Countdown ("in 12 days") | Subtle glow/pulse |
| Upcoming | ○ (empty) | Release date or "TBD" | Standard |

### Interactions

- Horizontal scroll for 5+ movies
- Hover shows quick details (score breakdown, release date)
- Click opens movie detail modal
- "Today" marker line indicates current position

### Empty States

- **Setup phase:** "Your movies will appear here after the draft"
- **No scores yet:** Timeline shows all upcoming with "Waiting for releases..."

---

## Phase-Specific Behavior

### Setup Phase
- **Default tab:** Draft
- Dashboard shows empty state with placeholder timeline
- Standings sidebar shows participants (no scores)

### Drafting Phase
- **Default tab:** Draft (draft board active)
- Dashboard accessible, shows "Draft in progress — X picks remaining"
- Movies appear on timeline in real-time as picked
- Standings shows draft order position instead of points

### Active Phase
- **Default tab:** Dashboard
- Full timeline with scored + upcoming movies
- Live standings with rankings
- Bidding tab enabled (badge if outbid)

### Completed Phase
- **Default tab:** Dashboard
- Timeline shows final results (all scored)
- Standings shows final rankings with trophy icons
- Bidding tab disabled/hidden
- Optional "Season Complete" banner

---

## Simplifications & Removals

### Removed
- `LeagueHeader` navigation tabs (Draft/Standings)
- `LeagueDetailClient` conditional tabs
- Standings as separate primary page

### Consolidated
- `ParticipantsList` → Draft tab only
- `InvitationsList` → Draft tab during setup
- Standings page → Sidebar + drill-down detail view

### Component Mapping

| Current | New |
|---------|-----|
| `LeagueDetailClient` with tabs | `LeagueDashboard` component |
| `LeagueHeader` with nav tabs | `LeagueHeader` with unified tab bar |
| `StandingsClient` (full page) | `StandingsSidebar` (compact) + detail view |
| `DraftBoard` as default | `DraftBoard` in Draft tab only |

---

## File Structure

```
apps/frontend/app/(authenticated)/league/[id]/
├── layout.tsx                    # NEW: Shared header + tab navigation
├── page.tsx                      # Redirects to default tab based on phase
│
├── dashboard/
│   ├── page.tsx                  # NEW: Server component
│   └── DashboardClient.tsx       # NEW: Team overview + timeline
│
├── draft/
│   ├── page.tsx                  # Server component (relocated)
│   └── DraftClient.tsx           # Draft board + participants sidebar
│
├── bidding/
│   ├── page.tsx                  # Server component (relocated)
│   └── BiddingClient.tsx         # Bidding panel
│
├── roster/
│   ├── page.tsx                  # Existing
│   └── RosterClient.tsx          # Existing
│
├── standings/
│   ├── page.tsx                  # Full standings detail (drill-down)
│   └── StandingsClient.tsx       # Refactored from current
│
├── settings/
│   └── ...                       # Existing
│
└── components/
    ├── LeagueHeader.tsx          # Refactored: unified tab bar
    ├── LeagueTabs.tsx            # NEW: Tab navigation component
    ├── TeamHeader.tsx            # NEW: Team name, rank, points
    ├── MovieTimeline.tsx         # NEW: Horizontal timeline
    ├── MovieTimelineCard.tsx     # NEW: Individual movie on timeline
    ├── StandingsSidebar.tsx      # NEW: Compact standings
    ├── StandingsSidebarItem.tsx  # NEW: Single team row
    ├── DraftBoard.tsx            # Existing (relocated)
    ├── MoviePicker.tsx           # Existing
    ├── ParticipantsList.tsx      # Existing
    ├── BiddingPanel.tsx          # Existing
    └── ...                       # Other existing components
```

---

## New Components

### LeagueTabs
- Renders tab navigation bar
- Handles active tab highlighting
- Disables/hides tabs based on league phase
- Shows badge on Bidding tab when user has been outbid

### TeamHeader
- Displays team name, rank badge, total points
- Rank badge styling: gold (#c9a227), silver (#a8a8a8), bronze (#cd7f32)
- Uses display font for team name

### MovieTimeline
- Horizontal scrollable container
- Renders MovieTimelineCard for each movie
- Shows "today" marker line
- Handles empty states per phase

### MovieTimelineCard
- Movie poster thumbnail
- Title (truncated if needed)
- Score OR countdown/date based on release status
- Visual state indicator (●/◐/○)
- Hover state with details
- Click handler for detail modal

### StandingsSidebar
- Fetches/receives all teams with scores
- Renders StandingsSidebarItem for each
- Highlights current user's team
- "View Full Standings" link at bottom

### StandingsSidebarItem
- Rank position (with tie handling)
- Team name (truncated if needed)
- Total points
- Top-scoring movie name + points
- Highlight styling for current user's team

---

## Data Requirements

### Dashboard Page Data
```typescript
// Server component fetches:
- League (id, name, status)
- Current user's team with movies and scores
- All teams with total_points and top movie
- User's participant record (for team ownership)

// Client receives:
interface DashboardData {
  league: League
  userTeam: TeamWithMovies
  standings: StandingEntry[]
  isOwner: boolean
}

interface TeamWithMovies {
  id: string
  name: string
  avatar_url: string | null
  total_points: number
  rank: number
  movies: MovieWithScore[]
}

interface MovieWithScore {
  id: string
  tmdb_id: number
  title: string
  poster_url: string
  release_date: string
  status: 'upcoming' | 'released' | 'scored'
  total_score: number | null
  scores: {
    imdb: number | null
    rt: number | null
    metacritic: number | null
  }
}

interface StandingEntry {
  rank: number
  team: {
    id: string
    name: string
    avatar_url: string | null
  }
  total_points: number
  topMovie: {
    title: string
    score: number
  } | null
  isCurrentUser: boolean
}
```

### Real-time Subscriptions
- `team_scores` updates → Refresh standings
- `movies` updates → Refresh timeline (new scores)
- `leagues` updates → Phase changes

---

## Implementation Order

1. **Create layout with tab navigation**
   - `layout.tsx` with LeagueHeader + LeagueTabs
   - Phase-aware default routing in `page.tsx`

2. **Build Dashboard components**
   - TeamHeader component
   - StandingsSidebar + StandingsSidebarItem
   - MovieTimeline + MovieTimelineCard

3. **Create Dashboard page**
   - Server component data fetching
   - DashboardClient assembly
   - Real-time subscriptions

4. **Relocate existing pages to tab structure**
   - Move draft board to `/draft`
   - Move bidding to `/bidding`
   - Update imports and routing

5. **Refactor LeagueHeader**
   - Remove old tab navigation
   - Integrate with new LeagueTabs

6. **Polish and edge cases**
   - Empty states per phase
   - Loading states
   - Error handling
   - Mobile responsiveness

---

## Success Criteria

- [ ] Landing on league page shows Dashboard (not draft) when league is active
- [ ] User can see their rank and points immediately
- [ ] Timeline shows all movies with clear scored/upcoming states
- [ ] Standings sidebar shows competition context at a glance
- [ ] Tab navigation is clear and phase-appropriate
- [ ] No redundant tab systems
- [ ] Smooth transitions between tabs
- [ ] Real-time updates work for scores and standings
