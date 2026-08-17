# Bidding UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the frontend UI for the fantasy budget bidding system, including bid placement, team roster management, and notifications.

**Architecture:** React components following existing patterns (Server components for data fetching, Client components for interactivity). Uses Cinematic Dark design system, Supabase real-time subscriptions, and Edge Function calls via `callEdgeFunction` utility.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Supabase Client, Sonner (toasts), Lucide Icons

---

## Task 1: Create useBidding Hook

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/hooks/useBidding.ts`

**Step 1: Create the hook file**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { PickupBid, TeamBudget } from '@/types'

interface UseBiddingOptions {
  leagueId: string
  teamId: string
}

interface UseBiddingReturn {
  bids: PickupBid[]
  myBids: PickupBid[]
  budget: TeamBudget | null
  loading: boolean
  error: string | null
  placeBid: (tmdbId: number, amount: number, movieData?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  cancelBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
  refetch: () => Promise<void>
}

export function useBidding({ leagueId, teamId }: UseBiddingOptions): UseBiddingReturn {
  const [bids, setBids] = useState<PickupBid[]>([])
  const [budget, setBudget] = useState<TeamBudget | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const fetchBids = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('pickup_bids')
      .select('*')
      .eq('league_id', leagueId)
      .in('status', ['active', 'outbid'])
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setBids(data || [])
    }
  }, [supabase, leagueId])

  const fetchBudget = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('team_budgets')
      .select('*')
      .eq('team_id', teamId)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      setError(fetchError.message)
    } else {
      setBudget(data)
    }
  }, [supabase, teamId])

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([fetchBids(), fetchBudget()])
    setLoading(false)
  }, [fetchBids, fetchBudget])

  // Initial fetch
  useEffect(() => {
    refetch()
  }, [refetch])

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`bidding-${leagueId}-${teamId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pickup_bids',
        filter: `league_id=eq.${leagueId}`,
      }, () => fetchBids())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_budgets',
        filter: `team_id=eq.${teamId}`,
      }, () => fetchBudget())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, leagueId, teamId, fetchBids, fetchBudget])

  const placeBid = useCallback(async (
    tmdbId: number,
    amount: number,
    movieData?: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> => {
    const { data, error: bidError } = await callEdgeFunction<{ bid: PickupBid }>('place-bid', {
      body: {
        league_id: leagueId,
        tmdb_id: tmdbId,
        amount,
        movie_data: movieData,
      },
    })

    if (bidError) {
      return { success: false, error: bidError }
    }

    await refetch()
    return { success: true }
  }, [leagueId, refetch])

  const cancelBid = useCallback(async (bidId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: cancelError } = await callEdgeFunction('cancel-bid', {
      body: { bid_id: bidId },
    })

    if (cancelError) {
      return { success: false, error: cancelError }
    }

    await refetch()
    return { success: true }
  }, [refetch])

  const myBids = bids.filter(bid => bid.team_id === teamId)

  return {
    bids,
    myBids,
    budget,
    loading,
    error,
    placeBid,
    cancelBid,
    refetch,
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/hooks/useBidding.ts
git commit -m "feat(ui): add useBidding hook for bid management"
```

---

## Task 2: Create BidCard Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/BidCard.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Clock, DollarSign, X, AlertTriangle } from 'lucide-react'
import type { PickupBid } from '@/types'

interface BidCardProps {
  bid: PickupBid
  isOwner: boolean
  onCancel?: () => void
  onCounter?: () => void
}

function formatTimeRemaining(deadline: string | null): string {
  if (!deadline) return 'Processing soon'

  const now = new Date()
  const end = new Date(deadline)
  const diff = end.getTime() - now.getTime()

  if (diff <= 0) return 'Processing soon'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  return `${hours}h ${minutes}m`
}

export default function BidCard({ bid, isOwner, onCancel, onCounter }: BidCardProps) {
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)

  const movieData = bid.movie_data as {
    title?: string
    poster_url?: string
    release_date?: string
  } | null

  const isOutbid = bid.status === 'outbid'
  const deadline = isOutbid ? bid.response_deadline : bid.processing_deadline

  return (
    <div className={`card p-4 ${isOutbid ? 'border-warning bg-warning-bg/20' : ''}`}>
      <div className="flex gap-4">
        {/* Movie Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded overflow-hidden bg-elevated">
          {movieData?.poster_url ? (
            <Image
              src={`https://image.tmdb.org/t/p/w92${movieData.poster_url}`}
              alt={movieData.title || 'Movie poster'}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-foreground-muted">
              No poster
            </div>
          )}
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-semibold text-foreground truncate">
            {movieData?.title || `Movie #${bid.tmdb_id}`}
          </h4>

          {movieData?.release_date && (
            <p className="text-sm text-foreground-secondary">
              {new Date(movieData.release_date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}

          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1 text-gold font-semibold">
              <DollarSign className="w-4 h-4" />
              <span>{bid.amount}</span>
            </div>

            <div className="flex items-center gap-1 text-foreground-secondary text-sm">
              <Clock className="w-4 h-4" />
              <span>{formatTimeRemaining(deadline)}</span>
            </div>
          </div>

          {isOutbid && (
            <div className="flex items-center gap-1 mt-2 text-warning text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>You&apos;ve been outbid!</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {isOwner && (
          <div className="flex flex-col gap-2">
            {isOutbid && onCounter && (
              <button
                onClick={onCounter}
                className="btn btn-primary text-sm py-1 px-3"
              >
                Counter
              </button>
            )}

            {bid.status === 'active' && (
              isConfirmingCancel ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      onCancel?.()
                      setIsConfirmingCancel(false)
                    }}
                    className="btn btn-danger text-xs py-1 px-2"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setIsConfirmingCancel(false)}
                    className="btn btn-ghost text-xs py-1 px-2"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsConfirmingCancel(true)}
                  className="btn btn-ghost text-sm py-1 px-2"
                  title="Cancel bid"
                >
                  <X className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/components/BidCard.tsx
git commit -m "feat(ui): add BidCard component for displaying bids"
```

---

## Task 3: Create PlaceBidModal Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/PlaceBidModal.tsx`

**Step 1: Create the modal component**

```typescript
'use client'

import { useState, useEffect, useRef } from 'react'
import { X, DollarSign, Search, Film } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import type { TMDbSearchResult, TeamBudget, PickupBid } from '@/types'
import { useDraftMovies } from '../hooks/useDraftMovies'

interface PlaceBidModalProps {
  isOpen: boolean
  onClose: () => void
  budget: TeamBudget | null
  existingBids: PickupBid[]
  draftedTmdbIds: number[]
  onPlaceBid: (tmdbId: number, amount: number, movieData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
}

export default function PlaceBidModal({
  isOpen,
  onClose,
  budget,
  existingBids,
  draftedTmdbIds,
  onPlaceBid,
}: PlaceBidModalProps) {
  const [selectedMovie, setSelectedMovie] = useState<TMDbSearchResult | null>(null)
  const [bidAmount, setBidAmount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)

  // Filter out movies that already have bids in this league
  const biddedTmdbIds = existingBids.map(b => b.tmdb_id)
  const excludedTmdbIds = [...draftedTmdbIds, ...biddedTmdbIds]

  const {
    results,
    loading,
    searchQuery,
    search,
    clearSearch,
  } = useDraftMovies({ draftedTmdbIds: excludedTmdbIds })

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMovie(null)
      setBidAmount(0)
      clearSearch()
    }
  }, [isOpen, clearSearch])

  const handleSubmit = async () => {
    if (!selectedMovie) return

    setIsSubmitting(true)

    const movieData = {
      title: selectedMovie.title,
      overview: selectedMovie.overview,
      poster_url: selectedMovie.poster_path,
      release_date: selectedMovie.release_date,
      vote_average: selectedMovie.vote_average,
      popularity: selectedMovie.popularity,
      genre_ids: selectedMovie.genre_ids,
    }

    const { success, error } = await onPlaceBid(selectedMovie.id, bidAmount, movieData)

    setIsSubmitting(false)

    if (success) {
      toast.success(`Bid of $${bidAmount} placed on ${selectedMovie.title}`)
      onClose()
    } else {
      toast.error(error || 'Failed to place bid')
    }
  }

  const remainingBudget = budget?.remaining_budget ?? 0
  const isValidBid = bidAmount >= 0 && bidAmount <= remainingBudget && bidAmount <= 100

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div ref={modalRef} className="glass max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-xl font-semibold text-foreground">Place a Bid</h2>
          <button onClick={onClose} className="btn btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Budget Display */}
        <div className="px-4 py-3 bg-elevated/50 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-foreground-secondary">Available Budget</span>
            <span className="font-display font-semibold text-gold text-lg">
              ${remainingBudget}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedMovie ? (
            <>
              {/* Search Input */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => search(e.target.value)}
                  placeholder="Search for a movie..."
                  className="input w-full pl-10"
                  autoFocus
                />
              </div>

              {/* Results */}
              <div className="space-y-2">
                {loading ? (
                  <div className="text-center py-8 text-foreground-muted">
                    Searching...
                  </div>
                ) : results.length === 0 ? (
                  <div className="text-center py-8 text-foreground-muted">
                    {searchQuery ? 'No movies found' : 'Search for a movie to place a bid'}
                  </div>
                ) : (
                  results.map((movie) => (
                    <button
                      key={movie.id}
                      onClick={() => setSelectedMovie(movie)}
                      className="w-full card card-interactive p-3 flex gap-3 text-left"
                    >
                      <div className="relative w-12 h-18 flex-shrink-0 rounded overflow-hidden bg-elevated">
                        {movie.poster_path ? (
                          <Image
                            src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                            alt={movie.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <Film className="w-6 h-6 text-foreground-muted m-auto" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground truncate">{movie.title}</h4>
                        <p className="text-sm text-foreground-secondary">
                          {movie.release_date ? new Date(movie.release_date).getFullYear() : 'TBA'}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* Selected Movie */}
              <div className="card p-4 mb-4">
                <div className="flex gap-4">
                  <div className="relative w-20 h-30 flex-shrink-0 rounded overflow-hidden bg-elevated">
                    {selectedMovie.poster_path ? (
                      <Image
                        src={`https://image.tmdb.org/t/p/w154${selectedMovie.poster_path}`}
                        alt={selectedMovie.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <Film className="w-8 h-8 text-foreground-muted m-auto" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-lg text-foreground">
                      {selectedMovie.title}
                    </h3>
                    <p className="text-foreground-secondary">
                      {selectedMovie.release_date
                        ? new Date(selectedMovie.release_date).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Release date TBA'}
                    </p>
                    <button
                      onClick={() => setSelectedMovie(null)}
                      className="text-gold text-sm mt-2 hover:underline"
                    >
                      Choose different movie
                    </button>
                  </div>
                </div>
              </div>

              {/* Bid Amount Input */}
              <div className="space-y-2">
                <label className="block text-foreground-secondary text-sm">
                  Bid Amount
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground-muted" />
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                    min={0}
                    max={Math.min(100, remainingBudget)}
                    className={`input w-full pl-10 text-lg ${!isValidBid ? 'border-error' : ''}`}
                    autoFocus
                  />
                </div>
                {!isValidBid && (
                  <p className="text-error text-sm">
                    {bidAmount > remainingBudget
                      ? `Exceeds your budget of $${remainingBudget}`
                      : bidAmount > 100
                      ? 'Maximum bid is $100'
                      : 'Bid must be $0 or more'}
                  </p>
                )}
                <p className="text-foreground-muted text-sm">
                  You can bid $0 to claim unclaimed movies for free.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {selectedMovie && (
          <div className="p-4 border-t border-border bg-elevated/30">
            <button
              onClick={handleSubmit}
              disabled={!isValidBid || isSubmitting}
              className="btn btn-primary w-full"
            >
              {isSubmitting ? 'Placing Bid...' : `Place $${bidAmount} Bid`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/components/PlaceBidModal.tsx
git commit -m "feat(ui): add PlaceBidModal for placing new bids"
```

---

## Task 4: Create BiddingPanel Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/BiddingPanel.tsx`

**Step 1: Create the panel component**

```typescript
'use client'

import { useState } from 'react'
import { DollarSign, Plus, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { League, PickupBid, TeamBudget } from '@/types'
import BidCard from './BidCard'
import PlaceBidModal from './PlaceBidModal'

interface BiddingPanelProps {
  league: League
  teamId: string
  bids: PickupBid[]
  myBids: PickupBid[]
  budget: TeamBudget | null
  draftedTmdbIds: number[]
  onPlaceBid: (tmdbId: number, amount: number, movieData: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  onCancelBid: (bidId: string) => Promise<{ success: boolean; error?: string }>
}

export default function BiddingPanel({
  league,
  teamId,
  bids,
  myBids,
  budget,
  draftedTmdbIds,
  onPlaceBid,
  onCancelBid,
}: BiddingPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [counterBidTarget, setCounterBidTarget] = useState<PickupBid | null>(null)

  const pickupSlots = league.total_slots - league.draft_slots
  const usedPickupSlots = 0 // TODO: Get from pickups query
  const availableSlots = pickupSlots - usedPickupSlots

  const handleCancelBid = async (bidId: string) => {
    const { success, error } = await onCancelBid(bidId)
    if (success) {
      toast.success('Bid cancelled')
    } else {
      toast.error(error || 'Failed to cancel bid')
    }
  }

  const handleCounter = (bid: PickupBid) => {
    setCounterBidTarget(bid)
    setIsModalOpen(true)
  }

  // Separate outbid (urgent) from active bids
  const outbidBids = myBids.filter(b => b.status === 'outbid')
  const activeBids = myBids.filter(b => b.status === 'active')

  // Other teams' active bids (for visibility)
  const otherBids = bids.filter(b => b.team_id !== teamId && b.status === 'active')

  return (
    <div className="space-y-6">
      {/* Budget & Slots Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-foreground-muted text-sm">Budget</p>
              <p className="font-display font-semibold text-2xl text-gold">
                ${budget?.remaining_budget ?? 100}
              </p>
            </div>
            <div className="h-10 w-px bg-border" />
            <div>
              <p className="text-foreground-muted text-sm">Pickup Slots</p>
              <p className="font-display font-semibold text-xl text-foreground">
                {usedPickupSlots}/{pickupSlots}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            disabled={availableSlots <= 0}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Place Bid
          </button>
        </div>
      </div>

      {/* Outbid Warning */}
      {outbidBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-warning" />
            Action Required ({outbidBids.length})
          </h3>
          {outbidBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={true}
              onCancel={() => handleCancelBid(bid.id)}
              onCounter={() => handleCounter(bid)}
            />
          ))}
        </div>
      )}

      {/* My Active Bids */}
      {activeBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gold" />
            My Active Bids ({activeBids.length})
          </h3>
          {activeBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={true}
              onCancel={() => handleCancelBid(bid.id)}
            />
          ))}
        </div>
      )}

      {/* Other Bids */}
      {otherBids.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground-secondary">
            Other Active Bids ({otherBids.length})
          </h3>
          {otherBids.map(bid => (
            <BidCard
              key={bid.id}
              bid={bid}
              isOwner={false}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {myBids.length === 0 && otherBids.length === 0 && (
        <div className="card p-8 text-center">
          <DollarSign className="w-12 h-12 text-foreground-muted mx-auto mb-4" />
          <h3 className="font-display font-semibold text-foreground mb-2">
            No Active Bids
          </h3>
          <p className="text-foreground-secondary mb-4">
            Place a bid on upcoming movies to add them to your roster.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Place Your First Bid
          </button>
        </div>
      )}

      {/* Place Bid Modal */}
      <PlaceBidModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setCounterBidTarget(null)
        }}
        budget={budget}
        existingBids={bids}
        draftedTmdbIds={draftedTmdbIds}
        onPlaceBid={onPlaceBid}
      />
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/components/BiddingPanel.tsx
git commit -m "feat(ui): add BiddingPanel component with bid list and actions"
```

---

## Task 5: Create Team Roster Page

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx`
- Create: `apps/frontend/app/(authenticated)/league/[id]/roster/RosterClient.tsx`

**Step 1: Create the server page component**

```typescript
// apps/frontend/app/(authenticated)/league/[id]/roster/page.tsx
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import RosterClient from './RosterClient'

interface RosterPageProps {
  params: Promise<{ id: string }>
}

export default async function RosterPage({ params }: RosterPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
    redirect('/dashboard')
  }

  // Get user's participant and team
  const { data: participant } = await supabase
    .from('league_participants')
    .select('id, teams(id, name)')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!participant) {
    redirect(`/league/${id}`)
  }

  const team = participant.teams as unknown as { id: string; name: string }

  // Fetch draft picks
  const { data: draftPicks } = await supabase
    .from('draft_picks')
    .select('*, movies(*)')
    .eq('team_id', team.id)
    .order('pick_number', { ascending: true })

  // Fetch pickups
  const { data: pickups } = await supabase
    .from('pickups')
    .select('*, movies(*)')
    .eq('team_id', team.id)
    .is('dropped_at', null)
    .order('picked_up_at', { ascending: true })

  // Fetch team budget
  const { data: budget } = await supabase
    .from('team_budgets')
    .select('*')
    .eq('team_id', team.id)
    .single()

  // Fetch drop count
  const { data: dropCount } = await supabase
    .rpc('get_team_drop_count', { p_team_id: team.id })

  return (
    <RosterClient
      league={league}
      team={team}
      draftPicks={draftPicks || []}
      pickups={pickups || []}
      budget={budget}
      dropCount={dropCount ?? 0}
      userId={user.id}
    />
  )
}
```

**Step 2: Create the client component**

```typescript
// apps/frontend/app/(authenticated)/league/[id]/roster/RosterClient.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Film, Trophy, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { League, Movie, TeamBudget, DraftPick, Pickup } from '@/types'

interface RosterClientProps {
  league: League
  team: { id: string; name: string }
  draftPicks: (DraftPick & { movies: Movie })[]
  pickups: (Pickup & { movies: Movie })[]
  budget: TeamBudget | null
  dropCount: number
  userId: string
}

export default function RosterClient({
  league,
  team,
  draftPicks: initialDraftPicks,
  pickups: initialPickups,
  budget,
  dropCount: initialDropCount,
  userId,
}: RosterClientProps) {
  const [pickups, setPickups] = useState(initialPickups)
  const [dropCount, setDropCount] = useState(initialDropCount)
  const [droppingId, setDroppingId] = useState<string | null>(null)

  const canDrop = dropCount < league.drop_limit

  const handleDrop = async (pickupId: string, movieTitle: string) => {
    if (!canDrop) {
      toast.error(`You've used all ${league.drop_limit} drops`)
      return
    }

    setDroppingId(pickupId)

    const { error } = await callEdgeFunction('drop-movie', {
      body: { pickup_id: pickupId },
    })

    setDroppingId(null)

    if (error) {
      toast.error(error)
    } else {
      toast.success(`Dropped ${movieTitle}`)
      setPickups(prev => prev.filter(p => p.id !== pickupId))
      setDropCount(prev => prev + 1)
    }
  }

  const totalMovies = initialDraftPicks.length + pickups.length
  const totalSlots = league.total_slots

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/league/${league.id}`}
          className="inline-flex items-center gap-2 text-foreground-secondary hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to League
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {team.name}&apos;s Roster
            </h1>
            <p className="text-foreground-secondary">
              {totalMovies}/{totalSlots} slots filled
            </p>
          </div>

          <div className="text-right">
            <p className="text-foreground-muted text-sm">Budget Remaining</p>
            <p className="font-display text-2xl font-semibold text-gold">
              ${budget?.remaining_budget ?? 100}
            </p>
            <p className="text-foreground-muted text-sm">
              Drops: {dropCount}/{league.drop_limit} used
            </p>
          </div>
        </div>
      </div>

      {/* Draft Picks Section */}
      <div className="mb-8">
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-gold" />
          Draft Picks ({initialDraftPicks.length})
        </h2>

        {initialDraftPicks.length === 0 ? (
          <p className="text-foreground-muted">No draft picks yet.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {initialDraftPicks.map((pick) => (
              <MovieCard
                key={pick.id}
                movie={pick.movies}
                label={`Round ${pick.round}, Pick ${pick.pick_number}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pickups Section */}
      <div>
        <h2 className="font-display font-semibold text-lg text-foreground flex items-center gap-2 mb-4">
          <ShoppingCart className="w-5 h-5 text-gold" />
          Pickups ({pickups.length})
        </h2>

        {pickups.length === 0 ? (
          <p className="text-foreground-muted">No pickups yet. Win bids to add movies!</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {pickups.map((pickup) => (
              <MovieCard
                key={pickup.id}
                movie={pickup.movies}
                label={`$${pickup.amount_paid}`}
                onDrop={canDrop ? () => handleDrop(pickup.id, pickup.movies.title) : undefined}
                isDropping={droppingId === pickup.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface MovieCardProps {
  movie: Movie
  label: string
  onDrop?: () => void
  isDropping?: boolean
}

function MovieCard({ movie, label, onDrop, isDropping }: MovieCardProps) {
  const [showDropConfirm, setShowDropConfirm] = useState(false)

  return (
    <div className="card overflow-hidden group">
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-elevated">
        {movie.poster_url ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${movie.poster_url}`}
            alt={movie.title}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-12 h-12 text-foreground-muted" />
          </div>
        )}

        {/* Drop Button */}
        {onDrop && !showDropConfirm && (
          <button
            onClick={() => setShowDropConfirm(true)}
            className="absolute top-2 right-2 p-2 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-crimson"
          >
            <Trash2 className="w-4 h-4 text-foreground" />
          </button>
        )}

        {/* Drop Confirmation */}
        {showDropConfirm && (
          <div className="absolute inset-0 bg-background/90 flex flex-col items-center justify-center p-4">
            <p className="text-foreground text-center mb-3">Drop this movie?</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onDrop?.()
                  setShowDropConfirm(false)
                }}
                disabled={isDropping}
                className="btn btn-danger text-sm py-1 px-3"
              >
                {isDropping ? '...' : 'Drop'}
              </button>
              <button
                onClick={() => setShowDropConfirm(false)}
                className="btn btn-ghost text-sm py-1 px-3"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-foreground text-sm truncate">{movie.title}</h3>
        <p className="text-foreground-muted text-xs">{label}</p>
        {movie.combined_score !== null && (
          <p className="text-gold text-sm font-semibold mt-1">
            {movie.combined_score.toFixed(1)} pts
          </p>
        )}
      </div>
    </div>
  )
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 4: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/roster/
git commit -m "feat(ui): add team roster page with draft picks and pickups"
```

---

## Task 6: Create useNotifications Hook

**Files:**
- Create: `apps/frontend/hooks/useNotifications.ts`

**Step 1: Create the hook**

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { Notification } from '@/types'

interface UseNotificationsReturn {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  error: string | null
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  refetch: () => Promise<void>
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error: fetchError } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setNotifications(data || [])
    }
    setLoading(false)
  }, [supabase])

  // Initial fetch
  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Real-time subscription
  useEffect(() => {
    const setupSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const channel = supabase
        .channel('user-notifications')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        }, (payload) => {
          setNotifications(prev => [payload.new as Notification, ...prev])
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        }, (payload) => {
          setNotifications(prev =>
            prev.map(n => n.id === payload.new.id ? payload.new as Notification : n)
          )
        })
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    setupSubscription()
  }, [supabase])

  const markAsRead = useCallback(async (notificationId: string) => {
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)

    if (!updateError) {
      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
        )
      )
    }
  }, [supabase])

  const markAllAsRead = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id)
    if (unreadIds.length === 0) return

    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds)

    if (!updateError) {
      setNotifications(prev =>
        prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      )
    }
  }, [supabase, notifications])

  const unreadCount = notifications.filter(n => !n.read_at).length

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/hooks/useNotifications.ts
git commit -m "feat(ui): add useNotifications hook with real-time updates"
```

---

## Task 7: Create NotificationBell Component

**Files:**
- Create: `apps/frontend/components/NotificationBell.tsx`

**Step 1: Create the component**

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell, Check, DollarSign, TrendingDown, Gift, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useNotifications } from '@/hooks/useNotifications'
import type { Notification, NotificationType } from '@/types'

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'outbid':
      return <AlertTriangle className="w-4 h-4 text-warning" />
    case 'bid_won':
      return <DollarSign className="w-4 h-4 text-success" />
    case 'bid_lost':
      return <TrendingDown className="w-4 h-4 text-error" />
    case 'pickup_available':
      return <Gift className="w-4 h-4 text-gold" />
    default:
      return <Bell className="w-4 h-4 text-foreground-muted" />
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`

  return date.toLocaleDateString()
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
  } = useNotifications()

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id)
    }
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-surface-hover transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5 text-foreground-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-crimson rounded-full flex items-center justify-center text-xs font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-hidden bg-surface border border-border rounded-lg shadow-heavy animate-fade-in z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-border">
            <h3 className="font-display font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-gold hover:underline flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
            {loading ? (
              <div className="p-4 text-center text-foreground-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-foreground-muted mx-auto mb-2" />
                <p className="text-foreground-muted">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() => handleNotificationClick(notification)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface NotificationItemProps {
  notification: Notification
  onClick: () => void
}

function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const isUnread = !notification.read_at
  const leagueId = notification.league_id
  const data = notification.data as { tmdb_id?: number; bid_id?: string } | null

  // Determine link based on notification type
  let href = leagueId ? `/league/${leagueId}` : '/dashboard'
  if (notification.type === 'outbid' && leagueId) {
    href = `/league/${leagueId}?tab=bidding`
  } else if (notification.type === 'bid_won' && leagueId) {
    href = `/league/${leagueId}/roster`
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block p-3 hover:bg-surface-hover transition-colors border-b border-border last:border-b-0 ${
        isUnread ? 'bg-elevated/50' : ''
      }`}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          {getNotificationIcon(notification.type)}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground-secondary'}`}>
            {notification.title}
          </p>
          <p className="text-xs text-foreground-muted mt-1 line-clamp-2">
            {notification.body}
          </p>
          <p className="text-xs text-foreground-muted mt-1">
            {formatTimeAgo(notification.created_at)}
          </p>
        </div>
        {isUnread && (
          <div className="flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-gold" />
          </div>
        )}
      </div>
    </Link>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/frontend && npx tsc --noEmit`

Expected: No errors

**Step 3: Commit**

```bash
git add apps/frontend/components/NotificationBell.tsx
git commit -m "feat(ui): add NotificationBell component with dropdown"
```

---

## Task 8: Add NotificationBell to Navigation

**Files:**
- Modify: `apps/frontend/app/(authenticated)/components/AuthenticatedNav.tsx`

**Step 1: Import and add NotificationBell**

Find the navigation component (likely `AuthenticatedNav.tsx` or similar) and add:

```typescript
// Add import at top
import NotificationBell from '@/components/NotificationBell'

// Add in the nav bar, before the user menu:
<NotificationBell />
```

**Step 2: Verify the app builds**

Run: `cd apps/frontend && npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/components/
git commit -m "feat(ui): add NotificationBell to authenticated navigation"
```

---

## Task 9: Add Bidding Tab to League Detail

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/LeagueDetailClient.tsx`

**Step 1: Import bidding components and hook**

Add imports:

```typescript
import { useBidding } from './hooks/useBidding'
import BiddingPanel from './components/BiddingPanel'
```

**Step 2: Add bidding state and integrate BiddingPanel**

Inside the component:

```typescript
// Get team ID from participants
const myTeam = participants.find(p => p.user_id === userId)?.teams
const teamId = (myTeam as unknown as { id: string })?.id

// Use bidding hook (only when league is active)
const {
  bids,
  myBids,
  budget,
  placeBid,
  cancelBid,
} = useBidding({
  leagueId: league.id,
  teamId: teamId || '',
})

// Get drafted tmdb_ids from draft picks
const draftedTmdbIds = draftPicks
  .map(pick => pick.movies?.tmdb_id)
  .filter((id): id is number => typeof id === 'number')
```

**Step 3: Add Bidding tab in the tab navigation**

In the tabs section, add a new tab for "Bidding" when league status is 'active':

```typescript
{league.status === 'active' && (
  <button
    onClick={() => setActiveTab('bidding')}
    className={getTabClassName('bidding')}
  >
    Bidding
  </button>
)}
```

**Step 4: Render BiddingPanel when tab is active**

```typescript
{activeTab === 'bidding' && league.status === 'active' && teamId && (
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
)}
```

**Step 5: Verify the app builds**

Run: `cd apps/frontend && npm run build`

Expected: Build succeeds

**Step 6: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/LeagueDetailClient.tsx
git commit -m "feat(ui): add Bidding tab to league detail page"
```

---

## Task 10: Update DraftBoard to Use draft_slots

**Files:**
- Modify: `apps/frontend/app/(authenticated)/league/[id]/components/DraftBoard.tsx`

**Step 1: Update round calculation**

Find where `totalRounds` is calculated (likely hardcoded as 5) and change to:

```typescript
// Before:
const totalRounds = 5

// After:
const totalRounds = league.draft_slots
```

**Step 2: Verify the app builds**

Run: `cd apps/frontend && npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/frontend/app/\(authenticated\)/league/\[id\]/components/DraftBoard.tsx
git commit -m "fix(ui): use league.draft_slots instead of hardcoded 5"
```

---

## Task 11: Add Vercel Cron for Bid Processing

**Files:**
- Create: `apps/frontend/app/api/cron/process-bids/route.ts`
- Modify: `vercel.json` (create if doesn't exist)

**Step 1: Create the cron API route**

```typescript
// apps/frontend/app/api/cron/process-bids/route.ts
import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: Request) {
  // Verify this is a Vercel cron request
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Determine mode from URL params
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') || 'weekly'

  // Call the Edge Function
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-bids`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ mode }),
    }
  )

  const data = await response.json()

  return NextResponse.json(data)
}
```

**Step 2: Create/update vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/process-bids?mode=weekly",
      "schedule": "0 20 * * 6"
    },
    {
      "path": "/api/cron/process-bids?mode=extended",
      "schedule": "0 * * * *"
    }
  ]
}
```

Note: `0 20 * * 6` = Every Saturday at 8pm UTC

**Step 3: Add CRON_SECRET to .env.example**

```bash
# Add to .env.example
CRON_SECRET=your-secret-here
```

**Step 4: Commit**

```bash
git add apps/frontend/app/api/cron/ vercel.json .env.example
git commit -m "feat(infra): add Vercel cron jobs for bid processing"
```

---

## Task 12: Create Email Templates for Bidding

**Files:**
- Create: `supabase/functions/_shared/email-templates/outbid.ts`
- Create: `supabase/functions/_shared/email-templates/bid-won.ts`
- Create: `supabase/functions/_shared/email-templates/bid-lost.ts`

**Step 1: Create outbid email template**

```typescript
// supabase/functions/_shared/email-templates/outbid.ts
export interface OutbidEmailData {
  recipientName: string
  movieTitle: string
  yourBidAmount: number
  newBidAmount: number
  counterDeadline: string
  leagueUrl: string
}

export function getOutbidEmailHtml(data: OutbidEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've Been Outbid</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; color: #c9a227; font-size: 24px; font-weight: 600;">
                ⚠️ You've Been Outbid!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                Hi ${data.recipientName},
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                Someone has outbid you on <strong style="color: #e8e8e8;">${data.movieTitle}</strong>.
              </p>

              <table role="presentation" style="width: 100%; background-color: #2a2a2a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="color: #8a8078; font-size: 14px;">Your bid:</td>
                        <td style="text-align: right; color: #e8e8e8; font-size: 16px; font-weight: 600;">$${data.yourBidAmount}</td>
                      </tr>
                      <tr>
                        <td style="color: #8a8078; font-size: 14px; padding-top: 8px;">New highest bid:</td>
                        <td style="text-align: right; color: #c9a227; font-size: 16px; font-weight: 600;">$${data.newBidAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 14px; line-height: 1.5;">
                You have until <strong style="color: #e8e8e8;">${data.counterDeadline}</strong> to place a counter-bid.
              </p>

              <a href="${data.leagueUrl}?tab=bidding"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Counter Bid Now
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2e2e2e; text-align: center;">
              <p style="margin: 0; color: #8a8078; font-size: 12px;">
                Fantasy Reel • Movie Fantasy League
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export function getOutbidEmailText(data: OutbidEmailData): string {
  return `
You've Been Outbid!

Hi ${data.recipientName},

Someone has outbid you on ${data.movieTitle}.

Your bid: $${data.yourBidAmount}
New highest bid: $${data.newBidAmount}

You have until ${data.counterDeadline} to place a counter-bid.

Counter bid now: ${data.leagueUrl}?tab=bidding

---
Fantasy Reel • Movie Fantasy League
  `.trim()
}
```

**Step 2: Create bid-won template**

```typescript
// supabase/functions/_shared/email-templates/bid-won.ts
export interface BidWonEmailData {
  recipientName: string
  movieTitle: string
  winningAmount: number
  leagueUrl: string
}

export function getBidWonEmailHtml(data: BidWonEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You Won!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; color: #c9a227; font-size: 24px; font-weight: 600;">
                🎬 You Won!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                Congratulations ${data.recipientName}!
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                Your bid of <strong style="color: #c9a227;">$${data.winningAmount}</strong> won <strong style="color: #e8e8e8;">${data.movieTitle}</strong>!
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                The movie has been added to your roster.
              </p>

              <a href="${data.leagueUrl}/roster"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Your Roster
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2e2e2e; text-align: center;">
              <p style="margin: 0; color: #8a8078; font-size: 12px;">
                Fantasy Reel • Movie Fantasy League
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export function getBidWonEmailText(data: BidWonEmailData): string {
  return `
🎬 You Won!

Congratulations ${data.recipientName}!

Your bid of $${data.winningAmount} won ${data.movieTitle}!

The movie has been added to your roster.

View your roster: ${data.leagueUrl}/roster

---
Fantasy Reel • Movie Fantasy League
  `.trim()
}
```

**Step 3: Create bid-lost template**

```typescript
// supabase/functions/_shared/email-templates/bid-lost.ts
export interface BidLostEmailData {
  recipientName: string
  movieTitle: string
  yourBidAmount: number
  winningAmount: number
  leagueUrl: string
}

export function getBidLostEmailHtml(data: BidLostEmailData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bid Unsuccessful</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; background-color: #1c1c1c; border-radius: 12px; border: 1px solid #2e2e2e;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2e2e2e;">
              <h1 style="margin: 0; color: #b8b0a4; font-size: 24px; font-weight: 600;">
                Bid Unsuccessful
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #e8e8e8; font-size: 16px; line-height: 1.5;">
                Hi ${data.recipientName},
              </p>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 16px; line-height: 1.5;">
                Unfortunately, your bid on <strong style="color: #e8e8e8;">${data.movieTitle}</strong> was unsuccessful.
              </p>

              <table role="presentation" style="width: 100%; background-color: #2a2a2a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="color: #8a8078; font-size: 14px;">Your bid:</td>
                        <td style="text-align: right; color: #e8e8e8; font-size: 16px;">$${data.yourBidAmount}</td>
                      </tr>
                      <tr>
                        <td style="color: #8a8078; font-size: 14px; padding-top: 8px;">Winning bid:</td>
                        <td style="text-align: right; color: #c9a227; font-size: 16px; font-weight: 600;">$${data.winningAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; color: #b8b0a4; font-size: 14px; line-height: 1.5;">
                Better luck next time! Check out other movies available for pickup.
              </p>

              <a href="${data.leagueUrl}?tab=bidding"
                 style="display: inline-block; background-color: #c9a227; color: #0f0f0f; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Browse Movies
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2e2e2e; text-align: center;">
              <p style="margin: 0; color: #8a8078; font-size: 12px;">
                Fantasy Reel • Movie Fantasy League
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export function getBidLostEmailText(data: BidLostEmailData): string {
  return `
Bid Unsuccessful

Hi ${data.recipientName},

Unfortunately, your bid on ${data.movieTitle} was unsuccessful.

Your bid: $${data.yourBidAmount}
Winning bid: $${data.winningAmount}

Better luck next time! Check out other movies available for pickup.

Browse movies: ${data.leagueUrl}?tab=bidding

---
Fantasy Reel • Movie Fantasy League
  `.trim()
}
```

**Step 4: Commit**

```bash
git add supabase/functions/_shared/email-templates/
git commit -m "feat(email): add bidding email templates (outbid, won, lost)"
```

---

## Task 13: Integrate Email Sending in place-bid

**Files:**
- Modify: `supabase/functions/place-bid/index.ts`

**Step 1: Import email utilities and templates**

Add at top of file:

```typescript
import { sendEmail } from '../_shared/email.ts'
import { getOutbidEmailHtml, getOutbidEmailText } from '../_shared/email-templates/outbid.ts'
```

**Step 2: Send email when outbidding someone**

Find the section where outbid notification is created (around line 270-290) and add email sending after the notification insert:

```typescript
// After: await serviceClient.from('notifications').insert({...})
// Add:

// Get user's email
const { data: outbidUser } = await serviceClient
  .from('profiles')
  .select('display_name, auth.users(email)')
  .eq('user_id', outbidUserId)
  .single()

const outbidEmail = (outbidUser?.users as unknown as { email: string })?.email
const recipientName = outbidUser?.display_name || 'Fantasy Manager'

if (outbidEmail) {
  const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  const emailData = {
    recipientName,
    movieTitle,
    yourBidAmount: highestBid.amount,
    newBidAmount: amount,
    counterDeadline: responseDeadline.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
    leagueUrl: `${baseUrl}/league/${league_id}`,
  }

  // Send email (non-blocking)
  sendEmail({
    to: outbidEmail,
    subject: `You've been outbid on ${movieTitle}`,
    html: getOutbidEmailHtml(emailData),
    text: getOutbidEmailText(emailData),
  }).catch(err => console.error('Failed to send outbid email:', err))
}
```

**Step 3: Commit**

```bash
git add supabase/functions/place-bid/index.ts
git commit -m "feat(email): send outbid email notification"
```

---

## Task 14: Integrate Email Sending in process-bids

**Files:**
- Modify: `supabase/functions/process-bids/index.ts`

**Step 1: Import email utilities and templates**

Add at top:

```typescript
import { sendEmail } from '../_shared/email.ts'
import { getBidWonEmailHtml, getBidWonEmailText } from '../_shared/email-templates/bid-won.ts'
import { getBidLostEmailHtml, getBidLostEmailText } from '../_shared/email-templates/bid-lost.ts'
```

**Step 2: Send emails after bid resolution**

After winner notification is created, add email:

```typescript
// After the winner notification insert, add:
const { data: winnerProfile } = await serviceClient
  .from('profiles')
  .select('display_name, auth.users(email)')
  .eq('user_id', winnerUserId)
  .single()

const winnerEmail = (winnerProfile?.users as unknown as { email: string })?.email
if (winnerEmail) {
  const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  sendEmail({
    to: winnerEmail,
    subject: `🎬 You won ${movieTitle}!`,
    html: getBidWonEmailHtml({
      recipientName: winnerProfile?.display_name || 'Fantasy Manager',
      movieTitle,
      winningAmount: winner.amount,
      leagueUrl: `${baseUrl}/league/${winner.league_id}`,
    }),
    text: getBidWonEmailText({
      recipientName: winnerProfile?.display_name || 'Fantasy Manager',
      movieTitle,
      winningAmount: winner.amount,
      leagueUrl: `${baseUrl}/league/${winner.league_id}`,
    }),
  }).catch(err => console.error('Failed to send bid won email:', err))
}
```

Similarly for losers in the notification loop:

```typescript
// In the loser notification loop, after insert, add:
const { data: loserProfile } = await serviceClient
  .from('profiles')
  .select('display_name, auth.users(email)')
  .eq('user_id', loserUserId)
  .single()

const loserEmail = (loserProfile?.users as unknown as { email: string })?.email
if (loserEmail) {
  const baseUrl = Deno.env.get('APP_URL') || 'https://fantasy-reel.vercel.app'
  sendEmail({
    to: loserEmail,
    subject: `Bid unsuccessful for ${movieTitle}`,
    html: getBidLostEmailHtml({
      recipientName: loserProfile?.display_name || 'Fantasy Manager',
      movieTitle,
      yourBidAmount: loserBid.amount,
      winningAmount: winner.amount,
      leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
    }),
    text: getBidLostEmailText({
      recipientName: loserProfile?.display_name || 'Fantasy Manager',
      movieTitle,
      yourBidAmount: loserBid.amount,
      winningAmount: winner.amount,
      leagueUrl: `${baseUrl}/league/${loserBid.league_id}`,
    }),
  }).catch(err => console.error('Failed to send bid lost email:', err))
}
```

**Step 3: Commit**

```bash
git add supabase/functions/process-bids/index.ts
git commit -m "feat(email): send bid won/lost email notifications"
```

---

## Verification Checklist

Before considering implementation complete:

- [ ] `npm run build` succeeds in frontend
- [ ] `npx tsc --noEmit` passes in frontend
- [ ] All existing tests still pass: `npm run test:functions`
- [ ] Manual test: Navigate to active league, see Bidding tab
- [ ] Manual test: Place a bid on a movie
- [ ] Manual test: See bid in "My Active Bids"
- [ ] Manual test: Cancel a bid
- [ ] Manual test: View team roster page
- [ ] Manual test: See notification bell with count
- [ ] Manual test: Click notification, mark as read
- [ ] Manual test: Verify emails sent (check Resend dashboard)

---

## Summary

This plan covers 14 tasks:

1. **useBidding hook** - State management for bids and budget
2. **BidCard component** - Display individual bid with actions
3. **PlaceBidModal component** - Movie search and bid placement
4. **BiddingPanel component** - Main bidding interface
5. **Team Roster page** - Draft picks and pickups display
6. **useNotifications hook** - Notification state with real-time
7. **NotificationBell component** - Dropdown with notifications
8. **Add NotificationBell to nav** - Integration point
9. **Add Bidding tab to league** - Tab navigation update
10. **Update DraftBoard** - Use draft_slots
11. **Vercel cron setup** - Weekly and hourly processing
12. **Email templates** - Outbid, won, lost templates
13. **Email in place-bid** - Send outbid emails
14. **Email in process-bids** - Send won/lost emails

Total estimated commits: 14
