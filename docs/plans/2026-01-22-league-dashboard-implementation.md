# League Dashboard Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the league page to be team-centric with a movie timeline and standings sidebar, replacing the current draft-centric default view.

**Architecture:** Next.js 15 App Router with nested layouts. The league `[id]` route gets a shared layout with unified tab navigation. Each tab (dashboard, draft, bidding, roster, settings) becomes a nested route. Phase-aware routing redirects to the appropriate default tab.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Supabase (client + realtime)

---

## Task 1: Add Dashboard Types

**Files:**
- Modify: `apps/frontend/types/index.ts`

**Step 1: Add new types for dashboard data**

Add these types at the end of the file (before the closing):

```typescript
// ============================================================================
// Dashboard types
// ============================================================================

export interface MovieTimelineItem {
  id: string
  tmdb_id: number
  title: string
  poster_url: string | null
  release_date: string | null
  status: 'scored' | 'releasing_soon' | 'upcoming'
  combined_score: number | null
  scores: {
    imdb: number | null
    rotten_tomatoes: number | null
    metacritic: number | null
  }
}

export interface DashboardTeam {
  id: string
  name: string
  avatar_url: string | null
  total_points: number
  rank: number
  movies: MovieTimelineItem[]
}

export interface StandingEntry {
  rank: number
  isTied: boolean
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

**Step 2: Commit**

```bash
git add apps/frontend/types/index.ts
git commit -m "feat(types): add dashboard types for team timeline and standings"
```

---

## Task 2: Create LeagueTabs Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/LeagueTabs.tsx`

**Step 1: Create the tab navigation component**

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { League } from '@/types'

interface Tab {
  name: string
  href: string
  disabled?: boolean
  badge?: number
}

interface Props {
  league: League
  outbidCount?: number
}

export default function LeagueTabs({ league, outbidCount = 0 }: Props) {
  const pathname = usePathname()
  const baseUrl = `/league/${league.id}`

  const tabs: Tab[] = [
    { name: 'Dashboard', href: `${baseUrl}/dashboard` },
    { name: 'Draft', href: `${baseUrl}/draft` },
    {
      name: 'Bidding',
      href: `${baseUrl}/bidding`,
      disabled: league.status === 'setup' || league.status === 'drafting',
      badge: outbidCount > 0 ? outbidCount : undefined,
    },
    { name: 'Roster', href: `${baseUrl}/roster` },
    { name: 'Settings', href: `${baseUrl}/settings` },
  ]

  return (
    <nav className="flex gap-1 border-b border-border overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        const isDisabled = tab.disabled

        if (isDisabled) {
          return (
            <span
              key={tab.name}
              className="px-4 py-3 text-sm font-medium text-foreground-muted/50 border-b-2 border-transparent cursor-not-allowed whitespace-nowrap"
            >
              {tab.name}
            </span>
          )
        }

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
              isActive
                ? 'text-gold border-gold'
                : 'text-foreground-secondary hover:text-foreground border-transparent'
            }`}
          >
            {tab.name}
            {tab.badge && (
              <span className="bg-crimson text-foreground text-xs px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/LeagueTabs.tsx
git commit -m "feat(league): add LeagueTabs navigation component"
```

---

## Task 3: Create Shared League Layout

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/layout.tsx`

**Step 1: Create the layout with shared header and tabs**

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import type { League } from '@/types'
import LeagueTabs from './components/LeagueTabs'
import ConnectionStatusIndicator from './components/ConnectionStatusIndicator'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function LeagueLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Check if user is a participant
  const { data: userParticipant } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!userParticipant) {
    redirect('/dashboard')
  }

  // Get participant count
  const { count: participantCount } = await supabase
    .from('league_participants')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', id)
    .eq('status', 'active')

  const isOwner = league.owner_id === user.id
  const typedLeague = league as League

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* League Header */}
        <div className="card p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold font-display text-foreground">
                {typedLeague.name}
              </h1>
              <div className="mt-3 flex items-center gap-4 flex-wrap">
                <span className={`badge ${STATUS_BADGE_CLASS[typedLeague.status]}`}>
                  {getStatusLabel(typedLeague.status)}
                </span>
                <span className="text-sm text-foreground-muted">
                  {typedLeague.invite_only ? 'Invite Only' : 'Open'}
                </span>
                <span className="text-sm text-foreground-muted">
                  {participantCount ?? 0} / {typedLeague.max_participants} participants
                </span>
              </div>
            </div>

            {isOwner && (
              <Link
                href={`/league/${typedLeague.id}/settings`}
                className="btn btn-ghost p-2"
                title="League Settings"
              >
                <Settings className="w-5 h-5" />
              </Link>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="mt-6">
            <LeagueTabs league={typedLeague} />
          </div>
        </div>

        {/* Page Content */}
        <div className="mt-6">
          {children}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/layout.tsx
git commit -m "feat(league): add shared layout with header and tab navigation"
```

---

## Task 4: Update Root League Page for Phase-Aware Redirect

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/page.tsx`

**Step 1: Replace contents with redirect logic**

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LeagueRootPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch league status for phase-aware redirect
  const { data: league, error } = await supabase
    .from('leagues')
    .select('status')
    .eq('id', id)
    .single()

  if (error || !league) {
    notFound()
  }

  // Phase-aware default tab:
  // - Setup/Drafting: Draft tab (the main event)
  // - Active/Completed: Dashboard tab (team performance)
  if (league.status === 'setup' || league.status === 'drafting') {
    redirect(`/league/${id}/draft`)
  } else {
    redirect(`/league/${id}/dashboard`)
  }
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/page.tsx
git commit -m "feat(league): add phase-aware redirect to default tab"
```

---

## Task 5: Create StandingsSidebar Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/StandingsSidebar.tsx`

**Step 1: Create the compact standings sidebar**

```typescript
import Link from 'next/link'
import { Trophy } from 'lucide-react'
import type { StandingEntry } from '@/types'

interface Props {
  leagueId: string
  standings: StandingEntry[]
}

const RANK_COLORS: Record<number, string> = {
  1: 'text-gold',
  2: 'text-[#a8a8a8]',
  3: 'text-[#cd7f32]',
}

export default function StandingsSidebar({ leagueId, standings }: Props) {
  if (standings.length === 0) {
    return (
      <div className="card p-4">
        <h3 className="font-display font-semibold text-foreground mb-4">Standings</h3>
        <p className="text-sm text-foreground-muted">
          Standings will appear once the draft is complete.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <h3 className="font-display font-semibold text-foreground mb-4">Standings</h3>

      <div className="space-y-3">
        {standings.map((entry) => (
          <div
            key={entry.team.id}
            className={`p-3 rounded-lg transition-colors ${
              entry.isCurrentUser
                ? 'bg-gold-muted border border-gold/30'
                : 'bg-elevated/50'
            }`}
          >
            <div className="flex items-center gap-3">
              {/* Rank */}
              <div className={`font-display font-bold text-lg w-6 ${RANK_COLORS[entry.rank] || 'text-foreground-muted'}`}>
                {entry.isTied ? `T${entry.rank}` : entry.rank}
              </div>

              {/* Team Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`font-medium truncate ${entry.isCurrentUser ? 'text-gold' : 'text-foreground'}`}>
                    {entry.team.name}
                  </span>
                  {entry.isCurrentUser && (
                    <span className="text-gold text-xs">★</span>
                  )}
                </div>
                {entry.topMovie && (
                  <p className="text-xs text-foreground-muted truncate mt-0.5">
                    Top: {entry.topMovie.title} ({entry.topMovie.score}pts)
                  </p>
                )}
              </div>

              {/* Points */}
              <div className="text-right">
                <span className="font-display font-bold text-foreground">
                  {entry.total_points}
                </span>
                <span className="text-xs text-foreground-muted ml-1">pts</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Link
        href={`/league/${leagueId}/standings`}
        className="mt-4 block text-center text-sm text-gold hover:text-gold-hover transition-colors"
      >
        View Full Standings →
      </Link>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/StandingsSidebar.tsx
git commit -m "feat(league): add StandingsSidebar component"
```

---

## Task 6: Create TeamHeader Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader.tsx`

**Step 1: Create the team header with rank and points**

```typescript
import { Trophy } from 'lucide-react'
import type { DashboardTeam } from '@/types'

interface Props {
  team: DashboardTeam
  totalTeams: number
}

const RANK_STYLES: Record<number, { bg: string; text: string; icon: boolean }> = {
  1: { bg: 'bg-gold/20', text: 'text-gold', icon: true },
  2: { bg: 'bg-[#a8a8a8]/20', text: 'text-[#a8a8a8]', icon: true },
  3: { bg: 'bg-[#cd7f32]/20', text: 'text-[#cd7f32]', icon: true },
}

export default function TeamHeader({ team, totalTeams }: Props) {
  const rankStyle = RANK_STYLES[team.rank] || { bg: 'bg-elevated', text: 'text-foreground-muted', icon: false }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        {/* Team Name */}
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">
            {team.name}
          </h2>
          <p className="text-sm text-foreground-muted mt-1">
            {team.movies.length} movies drafted
          </p>
        </div>

        {/* Rank and Points */}
        <div className="flex items-center gap-4">
          {/* Rank Badge */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${rankStyle.bg}`}>
            {rankStyle.icon && <Trophy className={`w-4 h-4 ${rankStyle.text}`} />}
            <span className={`font-display font-bold ${rankStyle.text}`}>
              #{team.rank}
            </span>
            <span className="text-xs text-foreground-muted">
              of {totalTeams}
            </span>
          </div>

          {/* Points */}
          <div className="text-right">
            <div className="text-3xl font-display font-bold text-gold">
              {team.total_points}
            </div>
            <div className="text-xs text-foreground-muted uppercase tracking-wide">
              points
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/TeamHeader.tsx
git commit -m "feat(league): add TeamHeader component with rank badge"
```

---

## Task 7: Create MovieTimelineCard Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/MovieTimelineCard.tsx`

**Step 1: Create the individual movie card for the timeline**

```typescript
import Image from 'next/image'
import type { MovieTimelineItem } from '@/types'

interface Props {
  movie: MovieTimelineItem
  onClick?: () => void
}

function getStatusIndicator(status: MovieTimelineItem['status']) {
  switch (status) {
    case 'scored':
      return { symbol: '●', className: 'text-foreground-muted' }
    case 'releasing_soon':
      return { symbol: '◐', className: 'text-gold animate-glow-pulse' }
    case 'upcoming':
      return { symbol: '○', className: 'text-foreground-muted' }
  }
}

function formatCountdown(releaseDate: string | null): string {
  if (!releaseDate) return 'TBD'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffMs = release.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'Released'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 30) return `${diffDays} days`
  if (diffDays <= 60) return '1 mo'
  if (diffDays <= 365) return `${Math.round(diffDays / 30)} mo`
  return 'TBD'
}

export default function MovieTimelineCard({ movie, onClick }: Props) {
  const indicator = getStatusIndicator(movie.status)
  const isScored = movie.status === 'scored'

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-32 group cursor-pointer transition-transform hover:scale-105 ${
        isScored ? 'opacity-80' : ''
      }`}
    >
      {/* Status Indicator */}
      <div className="flex justify-center mb-2">
        <span className={`text-xl ${indicator.className}`}>
          {indicator.symbol}
        </span>
      </div>

      {/* Poster */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-elevated border border-border group-hover:border-gold/50 transition-colors">
        {movie.poster_url ? (
          <Image
            src={movie.poster_url}
            alt={movie.title}
            fill
            className="object-cover"
            sizes="128px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-foreground-muted">
            No Poster
          </div>
        )}

        {/* Hover Overlay with Scores */}
        {isScored && movie.scores && (
          <div className="absolute inset-0 bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
            <div className="text-xs text-foreground-muted mb-1">Scores</div>
            <div className="text-xs space-y-0.5">
              {movie.scores.imdb && (
                <div className="text-yellow-400">IMDb: {movie.scores.imdb}</div>
              )}
              {movie.scores.rotten_tomatoes && (
                <div className="text-red-400">RT: {movie.scores.rotten_tomatoes}%</div>
              )}
              {movie.scores.metacritic && (
                <div className="text-green-400">MC: {movie.scores.metacritic}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-medium text-foreground truncate text-center">
        {movie.title}
      </p>

      {/* Score or Countdown */}
      <p className={`text-sm text-center ${isScored ? 'text-gold font-semibold' : 'text-foreground-muted'}`}>
        {isScored ? `${movie.combined_score} pts` : formatCountdown(movie.release_date)}
      </p>
    </button>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/MovieTimelineCard.tsx
git commit -m "feat(league): add MovieTimelineCard component"
```

---

## Task 8: Create MovieTimeline Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/MovieTimeline.tsx`

**Step 1: Create the horizontal timeline container**

```typescript
'use client'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import MovieTimelineCard from './MovieTimelineCard'
import type { MovieTimelineItem, League } from '@/types'

interface Props {
  movies: MovieTimelineItem[]
  leagueStatus: League['status']
  onMovieClick?: (movie: MovieTimelineItem) => void
}

export default function MovieTimeline({ movies, leagueStatus, onMovieClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const scrollAmount = 300
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  // Empty state for setup phase
  if (leagueStatus === 'setup') {
    return (
      <div className="card p-8 text-center">
        <div className="flex justify-center gap-4 mb-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-24 h-36 rounded-lg bg-elevated border border-border animate-pulse"
            />
          ))}
        </div>
        <p className="text-foreground-muted">
          Your movies will appear here after the draft
        </p>
      </div>
    )
  }

  // Empty state for drafting phase with no picks yet
  if (movies.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-foreground-muted">
          {leagueStatus === 'drafting'
            ? 'Draft your first movie to see it here'
            : 'No movies on your roster yet'}
        </p>
      </div>
    )
  }

  // Sort movies by release date
  const sortedMovies = [...movies].sort((a, b) => {
    if (!a.release_date) return 1
    if (!b.release_date) return -1
    return new Date(a.release_date).getTime() - new Date(b.release_date).getTime()
  })

  // Find today's position for the marker
  const today = new Date()
  const todayIndex = sortedMovies.findIndex((m) => {
    if (!m.release_date) return false
    return new Date(m.release_date) > today
  })

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-foreground">
          Movie Timeline
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => scroll('left')}
            className="p-1.5 rounded-lg bg-elevated hover:bg-surface-hover transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1.5 rounded-lg bg-elevated hover:bg-surface-hover transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Timeline Line */}
        <div className="absolute top-[18px] left-0 right-0 h-px bg-border" />

        {/* Today Marker */}
        {todayIndex > 0 && (
          <div
            className="absolute top-0 h-full w-px bg-gold z-10"
            style={{
              left: `${(todayIndex / sortedMovies.length) * 100}%`,
            }}
          >
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-gold whitespace-nowrap">
              Today
            </span>
          </div>
        )}

        {/* Scrollable Container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 pt-8 scrollbar-hide scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {sortedMovies.map((movie) => (
            <MovieTimelineCard
              key={movie.id}
              movie={movie}
              onClick={() => onMovieClick?.(movie)}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <span className="text-foreground-muted">●</span> Scored
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-gold">◐</span> Releasing Soon
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-foreground-muted">○</span> Upcoming
        </span>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/MovieTimeline.tsx
git commit -m "feat(league): add MovieTimeline horizontal scroll component"
```

---

## Task 9: Create DashboardClient Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx`

**Step 1: Create the main dashboard client component**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { League, DashboardTeam, StandingEntry } from '@/types'
import TeamHeader from '../components/TeamHeader'
import MovieTimeline from '../components/MovieTimeline'
import StandingsSidebar from '../components/StandingsSidebar'

interface Props {
  league: League
  userTeam: DashboardTeam | null
  standings: StandingEntry[]
  totalTeams: number
  currentUserId: string
}

export default function DashboardClient({
  league: initialLeague,
  userTeam: initialUserTeam,
  standings: initialStandings,
  totalTeams,
  currentUserId,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [userTeam, setUserTeam] = useState(initialUserTeam)
  const [standings, setStandings] = useState(initialStandings)

  const supabase = useMemo(() => createClient(), [])
  const channelIdRef = useRef(0)

  // Real-time subscription for score updates
  useEffect(() => {
    channelIdRef.current++
    const channelId = channelIdRef.current

    const channel = supabase
      .channel(`dashboard-${league.id}-${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'team_scores',
        },
        () => {
          // Refresh data when scores update
          // In a real implementation, we'd refetch the data
          console.log('Team scores updated')
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'movies',
        },
        () => {
          // Refresh when movie scores are calculated
          console.log('Movie scores updated')
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leagues',
          filter: `id=eq.${league.id}`,
        },
        (payload) => {
          setLeague(payload.new as League)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [league.id, supabase])

  // Empty state for when user has no team yet
  if (!userTeam) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card p-8 text-center">
            <h2 className="text-xl font-display font-semibold text-foreground mb-2">
              Welcome to {league.name}
            </h2>
            <p className="text-foreground-muted">
              {league.status === 'setup'
                ? 'Waiting for the draft to begin...'
                : 'Your team will appear here once you join the draft.'}
            </p>
          </div>
        </div>
        <div>
          <StandingsSidebar leagueId={league.id} standings={standings} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Content */}
      <div className="lg:col-span-2 space-y-6">
        <TeamHeader team={userTeam} totalTeams={totalTeams} />
        <MovieTimeline movies={userTeam.movies} leagueStatus={league.status} />
      </div>

      {/* Sidebar */}
      <div>
        <StandingsSidebar leagueId={league.id} standings={standings} />
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx
git commit -m "feat(league): add DashboardClient with team header, timeline, and standings"
```

---

## Task 10: Create Dashboard Page

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx`

**Step 1: Create the server component for dashboard data fetching**

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardClient from './DashboardClient'
import type {
  League,
  DashboardTeam,
  StandingEntry,
  MovieTimelineItem,
  Review,
} from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

function getMovieStatus(
  releaseDate: string | null,
  combinedScore: number | null
): MovieTimelineItem['status'] {
  if (combinedScore !== null) return 'scored'

  if (!releaseDate) return 'upcoming'

  const release = new Date(releaseDate)
  const now = new Date()
  const diffDays = Math.ceil((release.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays <= 30 && diffDays >= 0) return 'releasing_soon'
  return 'upcoming'
}

function extractScores(reviews: Review[]): MovieTimelineItem['scores'] {
  const scores: MovieTimelineItem['scores'] = {
    imdb: null,
    rotten_tomatoes: null,
    metacritic: null,
  }

  for (const review of reviews) {
    if (review.source === 'imdb') scores.imdb = review.score
    if (review.source === 'rotten_tomatoes') scores.rotten_tomatoes = review.score
    if (review.source === 'metacritic') scores.metacritic = review.score
  }

  return scores
}

export default async function DashboardPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Fetch all participants with teams and scores
  const { data: participants } = await supabase
    .from('league_participants')
    .select(`
      *,
      teams (
        *,
        team_scores (*)
      )
    `)
    .eq('league_id', id)
    .eq('status', 'active')

  // Fetch all draft picks with movies and reviews
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(`
      *,
      movies (
        *,
        reviews (*)
      )
    `)
    .eq('league_id', id)

  // Build team data
  const participantsData = participants || []
  const picksData = draftPicks || []

  // Calculate rankings
  const teamsWithScores = participantsData
    .filter((p) => p.teams)
    .map((p) => {
      const team = p.teams as { id: string; name: string; avatar_url: string | null; team_scores: { total_points: number } | null }
      return {
        participantUserId: p.user_id,
        team: {
          id: team.id,
          name: team.name,
          avatar_url: team.avatar_url,
        },
        total_points: team.team_scores?.total_points ?? 0,
      }
    })
    .sort((a, b) => b.total_points - a.total_points)

  // Assign ranks with tie handling
  let currentRank = 1
  const standings: StandingEntry[] = teamsWithScores.map((t, idx, arr) => {
    const prevTeam = arr[idx - 1]
    const isTied = prevTeam && prevTeam.total_points === t.total_points

    if (!isTied && idx > 0) {
      currentRank = idx + 1
    }

    // Find top movie for this team
    const teamPicks = picksData.filter((p) => p.team_id === t.team.id)
    const topMovie = teamPicks
      .map((p) => ({ title: p.movies?.title, score: p.movies?.combined_score }))
      .filter((m) => m.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]

    return {
      rank: currentRank,
      isTied,
      team: t.team,
      total_points: t.total_points,
      topMovie: topMovie ? { title: topMovie.title, score: topMovie.score ?? 0 } : null,
      isCurrentUser: t.participantUserId === user.id,
    }
  })

  // Find current user's team
  const userParticipant = participantsData.find((p) => p.user_id === user.id)
  let userTeam: DashboardTeam | null = null

  if (userParticipant?.teams) {
    const team = userParticipant.teams as {
      id: string
      name: string
      avatar_url: string | null
      team_scores: { total_points: number } | null
    }
    const userStanding = standings.find((s) => s.team.id === team.id)

    const userPicks = picksData.filter((p) => p.team_id === team.id)
    const movies: MovieTimelineItem[] = userPicks.map((pick) => {
      const movie = pick.movies as {
        id: string
        tmdb_id: number
        title: string
        poster_url: string | null
        release_date: string | null
        combined_score: number | null
        reviews: Review[]
      }

      return {
        id: movie.id,
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_date: movie.release_date,
        status: getMovieStatus(movie.release_date, movie.combined_score),
        combined_score: movie.combined_score,
        scores: extractScores(movie.reviews || []),
      }
    })

    userTeam = {
      id: team.id,
      name: team.name,
      avatar_url: team.avatar_url,
      total_points: team.team_scores?.total_points ?? 0,
      rank: userStanding?.rank ?? participantsData.length,
      movies,
    }
  }

  return (
    <DashboardClient
      league={league as League}
      userTeam={userTeam}
      standings={standings}
      totalTeams={participantsData.length}
      currentUserId={user.id}
    />
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx
git commit -m "feat(league): add Dashboard page with team data fetching"
```

---

## Task 11: Create Draft Page (Relocated)

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/draft/page.tsx`
- Create: `apps/frontend/app/(authenticated)/league/[id]/draft/DraftClient.tsx`

**Step 1: Create the draft page server component**

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DraftClient from './DraftClient'
import type { League, ParticipantWithTeam, DraftPickWithDetails } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DraftPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Check if user is a participant
  const { data: userParticipant } = await supabase
    .from('league_participants')
    .select('id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!userParticipant) {
    redirect('/dashboard')
  }

  // Fetch participants with their teams
  const { data: participants } = await supabase
    .from('league_participants')
    .select(`*, teams (*)`)
    .eq('league_id', id)
    .eq('status', 'active')
    .order('draft_order', { ascending: true })

  // Fetch draft picks with movie and team info
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(`*, movies (*), teams (*)`)
    .eq('league_id', id)
    .order('round', { ascending: true })
    .order('pick_number', { ascending: true })

  const isOwner = league.owner_id === user.id

  return (
    <DraftClient
      league={league as League}
      participants={(participants || []) as ParticipantWithTeam[]}
      draftPicks={(draftPicks || []) as DraftPickWithDetails[]}
      currentUserId={user.id}
      isOwner={isOwner}
    />
  )
}
```

**Step 2: Create the draft client component (based on current LeagueDetailClient)**

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, ParticipantWithTeam, DraftPickWithDetails } from '@/types'
import DraftBoard from '../components/DraftBoard'
import InvitationsList from '../components/InvitationsList'
import InviteModal from '../components/InviteModal'
import ParticipantsList from '../components/ParticipantsList'

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY_MS = 2000

interface Props {
  league: League
  participants: ParticipantWithTeam[]
  draftPicks: DraftPickWithDetails[]
  currentUserId: string
  isOwner: boolean
}

export default function DraftClient({
  league: initialLeague,
  participants: initialParticipants,
  draftPicks: initialDraftPicks,
  currentUserId,
  isOwner,
}: Props) {
  const [league, setLeague] = useState(initialLeague)
  const [participants, setParticipants] = useState(initialParticipants)
  const [draftPicks, setDraftPicks] = useState(initialDraftPicks)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local favorites state
  const [favoriteMovieIds, setFavoriteMovieIds] = useState<Set<number>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`draft-favorites-${initialLeague.id}`)
      if (stored) {
        try {
          return new Set(JSON.parse(stored))
        } catch {
          return new Set()
        }
      }
    }
    return new Set()
  })

  const supabase = useMemo(() => createClient(), [])
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const channelIdRef = useRef(0)

  // Persist favorites
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        `draft-favorites-${league.id}`,
        JSON.stringify([...favoriteMovieIds])
      )
    }
  }, [favoriteMovieIds, league.id])

  const fetchDraftPicks = useCallback(async () => {
    const { data } = await supabase
      .from('draft_picks')
      .select(`*, movies (*), teams (*)`)
      .eq('league_id', league.id)
      .order('round', { ascending: true })
      .order('pick_number', { ascending: true })

    if (data) {
      setDraftPicks(data as DraftPickWithDetails[])
    }
  }, [supabase, league.id])

  const fetchParticipants = useCallback(async () => {
    const { data } = await supabase
      .from('league_participants')
      .select(`*, teams (*)`)
      .eq('league_id', league.id)
      .eq('status', 'active')
      .order('draft_order', { ascending: true })

    if (data) {
      setParticipants(data as ParticipantWithTeam[])
    }
  }, [supabase, league.id])

  // Real-time subscriptions
  useEffect(() => {
    let currentChannel: ReturnType<typeof supabase.channel> | null = null
    let isCleaningUp = false

    function setupChannel(): void {
      if (isCleaningUp) return

      if (currentChannel) {
        supabase.removeChannel(currentChannel)
        currentChannel = null
      }

      channelIdRef.current++
      const thisChannelId = channelIdRef.current

      const channel = supabase
        .channel(`draft-${league.id}-${thisChannelId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'draft_picks',
            filter: `league_id=eq.${league.id}`,
          },
          fetchDraftPicks
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'leagues',
            filter: `id=eq.${league.id}`,
          },
          (payload) => setLeague(payload.new as League)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'league_participants',
            filter: `league_id=eq.${league.id}`,
          },
          fetchParticipants
        )
        .subscribe((status) => {
          if (isCleaningUp || thisChannelId !== channelIdRef.current) return

          if (status === 'SUBSCRIBED') {
            reconnectAttemptsRef.current = 0
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current++
              reconnectTimeoutRef.current = setTimeout(setupChannel, RECONNECT_DELAY_MS)
            }
          }
        })

      currentChannel = channel
    }

    setupChannel()

    return () => {
      isCleaningUp = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (currentChannel) {
        supabase.removeChannel(currentChannel)
      }
    }
  }, [league.id, supabase, fetchDraftPicks, fetchParticipants])

  const handlePickMade = useCallback(() => {
    fetchDraftPicks()
  }, [fetchDraftPicks])

  const handleToggleFavorite = useCallback((tmdbId: number) => {
    setFavoriteMovieIds((prev) => {
      const next = new Set(prev)
      if (next.has(tmdbId)) {
        next.delete(tmdbId)
      } else {
        next.add(tmdbId)
      }
      return next
    })
  }, [])

  async function handleStartDraft(): Promise<void> {
    if (participants.length < 2) {
      setError('Need at least 2 participants to start the draft')
      return
    }

    setStartingDraft(true)
    setError(null)

    const { error: startError } = await callEdgeFunction('start-draft', {
      body: { league_id: league.id },
    })

    if (startError) {
      setError(startError)
    }

    setStartingDraft(false)
  }

  return (
    <>
      {/* Owner Controls for Setup */}
      {isOwner && league.status === 'setup' && (
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => setShowInviteModal(true)} className="btn btn-secondary">
            Invite Players
          </button>
          <button
            onClick={handleStartDraft}
            disabled={startingDraft || participants.length < 2}
            className="btn btn-primary"
          >
            {startingDraft ? 'Starting...' : 'Start Draft'}
          </button>
          {error && <span className="text-sm text-error">{error}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DraftBoard
            league={league}
            participants={participants}
            draftPicks={draftPicks}
            currentUserId={currentUserId}
            favoriteMovieIds={favoriteMovieIds}
            onPickMade={handlePickMade}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>

        <div className="space-y-6">
          <ParticipantsList participants={participants} ownerId={league.owner_id} />
          {league.status === 'setup' && (
            <InvitationsList
              leagueId={league.id}
              isOwner={isOwner}
              leagueStatus={league.status}
            />
          )}
        </div>
      </div>

      {showInviteModal && (
        <InviteModal leagueId={league.id} onClose={() => setShowInviteModal(false)} />
      )}
    </>
  )
}
```

**Step 3: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/draft/
git commit -m "feat(league): add Draft page with relocated draft functionality"
```

---

## Task 12: Create Bidding Page (Relocated)

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/bidding/page.tsx`
- Create: `apps/frontend/app/(authenticated)/league/[id]/bidding/BiddingClient.tsx`

**Step 1: Create the bidding page server component**

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import BiddingClient from './BiddingClient'
import type { League, DraftPickWithDetails } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function BiddingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Fetch the league
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (leagueError || !league) {
    notFound()
  }

  // Bidding only available for active leagues
  if (league.status !== 'active') {
    redirect(`/league/${id}`)
  }

  // Get user's team
  const { data: participant } = await supabase
    .from('league_participants')
    .select(`*, teams (*)`)
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!participant) {
    redirect('/dashboard')
  }

  const team = participant.teams as { id: string } | null
  if (!team) {
    redirect(`/league/${id}`)
  }

  // Fetch draft picks for drafted tmdb_ids
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select(`*, movies (tmdb_id)`)
    .eq('league_id', id)

  const draftedTmdbIds = (draftPicks || [])
    .map((p) => p.movies?.tmdb_id)
    .filter((id): id is number => typeof id === 'number')

  return (
    <BiddingClient
      league={league as League}
      teamId={team.id}
      draftedTmdbIds={draftedTmdbIds}
    />
  )
}
```

**Step 2: Create the bidding client component**

```typescript
'use client'

import type { League } from '@/types'
import BiddingPanel from '../components/BiddingPanel'
import { useBidding } from '../hooks/useBidding'

interface Props {
  league: League
  teamId: string
  draftedTmdbIds: number[]
}

export default function BiddingClient({ league, teamId, draftedTmdbIds }: Props) {
  const {
    bids,
    myBids,
    budget,
    placeBid,
    cancelBid,
  } = useBidding({
    leagueId: league.id,
    teamId,
  })

  return (
    <BiddingPanel
      league={league}
      teamId={teamId}
      bids={bids}
      myBids={myBids}
      budget={budget}
      draftedTmdbIds={draftedTmdbIds}
      onPlaceBid={placeBid}
      onCancelBid={cancelBid}
    />
  )
}
```

**Step 3: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/bidding/
git commit -m "feat(league): add Bidding page with relocated bidding functionality"
```

---

## Task 13: Remove Old LeagueDetailClient Tab Logic

**Files:**
- Delete: `apps/frontend/app/(authenticated)/league/[id]/LeagueDetailClient.tsx`

**Step 1: Delete the old client component**

The old `LeagueDetailClient.tsx` is no longer needed since we've split functionality into separate pages.

```bash
rm apps/frontend/app/(authenticated)/league/[id]/LeagueDetailClient.tsx
```

**Step 2: Commit**

```bash
git add -A
git commit -m "refactor(league): remove old LeagueDetailClient (replaced by tab pages)"
```

---

## Task 14: Update LeagueHeader (Remove Old Tabs)

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/LeagueHeader.tsx`

**Step 1: Simplify LeagueHeader to remove redundant tab navigation**

Replace the file contents:

```typescript
'use client'

import { useState } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'

interface Props {
  league: League
  isOwner: boolean
  participantCount: number
  onInviteClick?: () => void
  onStartDraft?: () => void
}

export default function LeagueHeader({
  league,
  isOwner,
  participantCount,
  onInviteClick,
  onStartDraft,
}: Props) {
  // This component is now simpler - tabs moved to LeagueTabs in layout
  // Kept for backward compatibility with components that still use it
  return null
}
```

Actually, since the header is now in the layout, we can keep this component for any page that needs owner controls. Let me revise:

```typescript
'use client'

import { useState } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League } from '@/types'

interface Props {
  league: League
  isOwner: boolean
  participantCount: number
  showControls?: boolean
  onInviteClick?: () => void
}

export default function LeagueHeader({
  league,
  isOwner,
  participantCount,
  showControls = false,
  onInviteClick,
}: Props) {
  const [startingDraft, setStartingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStartDraft(): Promise<void> {
    if (participantCount < 2) {
      setError('Need at least 2 participants to start the draft')
      return
    }

    setStartingDraft(true)
    setError(null)

    const { error: startError } = await callEdgeFunction('start-draft', {
      body: { league_id: league.id },
    })

    if (startError) {
      setError(startError)
    }

    setStartingDraft(false)
  }

  if (!showControls || !isOwner || league.status !== 'setup') {
    return null
  }

  return (
    <div className="flex items-center gap-3 mb-6">
      <button onClick={onInviteClick} className="btn btn-secondary">
        Invite Players
      </button>
      <button
        onClick={handleStartDraft}
        disabled={startingDraft || participantCount < 2}
        className="btn btn-primary"
      >
        {startingDraft ? 'Starting...' : 'Start Draft'}
      </button>
      {error && <span className="text-sm text-error">{error}</span>}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/LeagueHeader.tsx
git commit -m "refactor(league): simplify LeagueHeader, tabs now in layout"
```

---

## Task 15: Update Existing Pages to Work Without Layout Header

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/settings/page.tsx`

**Step 1: Update roster page to remove duplicate header**

Read the current roster page and ensure it doesn't duplicate the header that's now in the layout.

**Step 2: Update standings page similarly**

The standings page should work within the new layout without changes (it doesn't render its own header/tabs outside its content area).

**Step 3: Update settings page similarly**

The settings page should also work within the new layout.

**Step 4: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx
git add apps/frontend/app/(authenticated)/league/[id]/standings/page.tsx
git add apps/frontend/app/(authenticated)/league/[id]/settings/page.tsx
git commit -m "refactor(league): update existing pages to work with shared layout"
```

---

## Task 16: Test and Verify Navigation

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Manual testing checklist**

- [ ] Navigate to a league in setup phase → redirects to `/league/[id]/draft`
- [ ] Navigate to a league in active phase → redirects to `/league/[id]/dashboard`
- [ ] Tab navigation works correctly
- [ ] Dashboard shows team header, timeline, and standings sidebar
- [ ] Draft tab shows draft board with participants
- [ ] Bidding tab is disabled during setup/drafting
- [ ] Roster and Settings tabs work correctly

**Step 3: Fix any issues found during testing**

---

## Task 17: Final Cleanup and Polish

**Step 1: Remove any unused imports/components**

**Step 2: Run linter**

```bash
npm run lint
```

**Step 3: Fix any lint errors**

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(league): cleanup unused code and fix lint errors"
```

---

## Success Criteria

- [ ] Landing on league page shows Dashboard (not draft) when league is active
- [ ] User can see their rank and points immediately on dashboard
- [ ] Timeline shows all movies with clear scored/upcoming states
- [ ] Standings sidebar shows competition context at a glance
- [ ] Tab navigation is clear and phase-appropriate
- [ ] No redundant tab systems
- [ ] Smooth transitions between tabs
- [ ] Real-time updates work for scores and standings
