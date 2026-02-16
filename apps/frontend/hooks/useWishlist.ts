'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { TMDbSearchResult } from '@/types'

interface UseWishlistReturn {
  wishlistedIds: Set<number>
  isLoading: boolean
  toggleWishlist: (movie: TMDbSearchResult) => void
  isWishlisted: (tmdbId: number) => boolean
}

/**
 * Hook for managing a user's movie wishlist with optimistic updates.
 *
 * Each component mount gets its own copy of the data (not a global singleton).
 * Uses a ref-based guard to prevent duplicate API calls for the same movie.
 */
export function useWishlist(): UseWishlistReturn {
  const [wishlistedIds, setWishlistedIds] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const inFlightRef = useRef<Set<number>>(new Set())

  const supabase = useMemo(() => createClient(), [])

  // Fetch wishlist on mount
  useEffect(() => {
    let cancelled = false

    async function fetchWishlist() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data, error } = await supabase
        .from('wishlisted_movies')
        .select('tmdb_id')
        .eq('user_id', user.id)

      if (cancelled) return

      if (error) {
        console.error('Failed to fetch wishlist:', error.message)
      } else {
        setWishlistedIds(new Set(data?.map((row) => row.tmdb_id) ?? []))
      }
      setIsLoading(false)
    }

    fetchWishlist()
    return () => { cancelled = true }
  }, [supabase])

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

      const wasWishlisted = wishlistedIds.has(tmdbId)

      // Optimistic update
      setWishlistedIds((prev) => {
        const next = new Set(prev)
        if (wasWishlisted) {
          next.delete(tmdbId)
        } else {
          next.add(tmdbId)
        }
        return next
      })

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
        // Roll back optimistic update
        setWishlistedIds((prev) => {
          const next = new Set(prev)
          if (wasWishlisted) {
            next.add(tmdbId)
          } else {
            next.delete(tmdbId)
          }
          return next
        })
        console.error('Failed to toggle wishlist:', err)
      } finally {
        inFlightRef.current.delete(tmdbId)
      }
    },
    [supabase, wishlistedIds]
  )

  const isWishlisted = useCallback(
    (tmdbId: number) => wishlistedIds.has(tmdbId),
    [wishlistedIds]
  )

  return { wishlistedIds, isLoading, toggleWishlist, isWishlisted }
}
