'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { TMDbSearchResult, WishlistedMovie } from '@/types'

interface WishlistContextValue {
  wishlistedIds: Set<number>
  wishlistMovies: WishlistedMovie[]
  isLoading: boolean
  error: string | null
  retry: () => void
  toggleWishlist: (movie: TMDbSearchResult) => void
  isWishlisted: (tmdbId: number) => boolean
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

function clearLegacyLocalStorageFavorites(): void {
  if (typeof window === 'undefined') return
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('draft-favorites-')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key))
}

/**
 * Provider that manages wishlist state. Mount once in the authenticated layout
 * so all consumers share the same data.
 *
 * Not a design-system component, but it must still be a bundle export so
 * design-sync can wrap every preview in it — anything rendering WishlistToggle
 * (DraftMovieCard, MovieQuickPreview) throws without it. That is what
 * `-provider` means: exported, pinned to null in componentSrcMap, and written
 * to `cfg.provider` rather than given a preview card of its own.
 * @design-system-provider
 */
export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [wishlistedIds, setWishlistedIds] = useState<Set<number>>(new Set())
  const [wishlistMovies, setWishlistMovies] = useState<WishlistedMovie[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const retry = useCallback(() => setRequestVersion(version => version + 1), [])
  const inFlightRef = useRef<Set<number>>(new Set())
  const wishlistedIdsRef = useRef(wishlistedIds)
  wishlistedIdsRef.current = wishlistedIds

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false

    async function fetchWishlist() {
      setIsLoading(true)
      setError(null)
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError) throw authError
        if (!user) throw new Error('Sign in again to load your wishlist.')
        if (cancelled) return

        const { data, error } = await supabase
          .from('wishlisted_movies')
          .select('*')
          .eq('user_id', user.id)
          .order('added_at', { ascending: false })
        if (error) throw error
        if (cancelled) return
        const rows = data ?? []
        setWishlistedIds(new Set(rows.map((row) => row.tmdb_id)))
        setWishlistMovies(rows)
        clearLegacyLocalStorageFavorites()
      } catch {
        if (!cancelled) setError('Could not load your wishlist. Please try again.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchWishlist()
    return () => { cancelled = true }
  }, [supabase, requestVersion])

  const toggleWishlist = useCallback(
    async (movie: TMDbSearchResult) => {
      const tmdbId = movie.tmdb_id

      // Ref-based guard: ignore if this tmdb_id already has a pending call
      if (inFlightRef.current.has(tmdbId)) return
      inFlightRef.current.add(tmdbId)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        inFlightRef.current.delete(tmdbId)
        return
      }

      const wasWishlisted = wishlistedIdsRef.current.has(tmdbId)

      function toggleIdSet(prev: Set<number>, adding: boolean): Set<number> {
        const next = new Set(prev)
        if (adding) {
          next.add(tmdbId)
        } else {
          next.delete(tmdbId)
        }
        return next
      }

      function buildWishlistMovie(): WishlistedMovie {
        return {
          id: crypto.randomUUID(),
          user_id: user!.id,
          tmdb_id: tmdbId,
          title: movie.title,
          poster_url: movie.poster_url,
          added_at: new Date().toISOString(),
        }
      }

      function applyOptimisticUpdate(adding: boolean): void {
        setWishlistedIds((prev) => toggleIdSet(prev, adding))
        if (adding) {
          setWishlistMovies((prev) => [buildWishlistMovie(), ...prev])
        } else {
          setWishlistMovies((prev) => prev.filter((wm) => wm.tmdb_id !== tmdbId))
        }
      }

      applyOptimisticUpdate(!wasWishlisted)

      try {
        if (wasWishlisted) {
          const { error } = await supabase
            .from('wishlisted_movies')
            .delete()
            .eq('user_id', user.id)
            .eq('tmdb_id', tmdbId)

          if (error) throw error
        } else {
          const { error } = await supabase
            .from('wishlisted_movies')
            .upsert(
              {
                user_id: user.id,
                tmdb_id: tmdbId,
                title: movie.title,
                poster_url: movie.poster_url,
              },
              { onConflict: 'user_id,tmdb_id' }
            )

          if (error) throw error
        }
      } catch (err) {
        applyOptimisticUpdate(wasWishlisted)
        console.error('Failed to toggle wishlist:', err)
      } finally {
        inFlightRef.current.delete(tmdbId)
      }
    },
    [supabase]
  )

  const isWishlisted = useCallback(
    (tmdbId: number) => wishlistedIds.has(tmdbId),
    [wishlistedIds]
  )

  const value = useMemo(
    () => ({ wishlistedIds, wishlistMovies, isLoading, error, retry, toggleWishlist, isWishlisted }),
    [wishlistedIds, wishlistMovies, isLoading, error, retry, toggleWishlist, isWishlisted]
  )

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  )
}

/**
 * Access the shared wishlist state. Must be used within WishlistProvider.
 */
export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext)
  if (!ctx) {
    throw new Error('useWishlist must be used within a WishlistProvider')
  }
  return ctx
}
