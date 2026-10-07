'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { GenerateJoinLinkResponse } from '@/types'

interface UseLeagueJoinLinkReturn {
  /** The current code, null when none has been generated, undefined while loading or after a failed read. */
  joinCode: string | null | undefined
  /** Set when the code couldn't be read. */
  loadError: string | null
  /** Mints a new code (replacing any old one). Throws on failure. */
  generate: () => Promise<void>
}

/**
 * The league's shareable join code. It lives in `league_join_links`, which
 * only the league owner can read, so this is for owner-only UI.
 */
export function useLeagueJoinLink(leagueId: string): UseLeagueJoinLinkReturn {
  const [joinCode, setJoinCode] = useState<string | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('league_join_links')
      .select('join_code')
      .eq('league_id', leagueId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        // On a failed read, don't fall back to "no code": generating one would
        // silently replace a code the owner may already have shared.
        if (error) setLoadError("Couldn't load the join link. Refresh to try again.")
        else setJoinCode(data?.join_code ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, supabase])

  const generate = useCallback(async () => {
    const { data, error } = await callEdgeFunction<GenerateJoinLinkResponse>(
      'generate-join-link',
      { body: { league_id: leagueId } }
    )
    if (error) throw new Error(error)
    if (data) {
      setJoinCode(data.join_code)
      setLoadError(null)
    }
  }, [leagueId])

  return { joinCode, loadError, generate }
}
