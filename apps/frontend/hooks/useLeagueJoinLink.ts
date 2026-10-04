'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { GenerateJoinLinkResponse } from '@/types'

interface UseLeagueJoinLinkReturn {
  /** The current code, null when none has been generated, undefined while loading. */
  joinCode: string | null | undefined
  /** Mints a new code (replacing any old one). Throws on failure. */
  generate: () => Promise<void>
}

/**
 * The league's shareable join code. It lives in `league_join_links`, which
 * only the league owner can read, so this is for owner-only UI.
 */
export function useLeagueJoinLink(leagueId: string): UseLeagueJoinLinkReturn {
  const [joinCode, setJoinCode] = useState<string | null | undefined>(undefined)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('league_join_links')
      .select('join_code')
      .eq('league_id', leagueId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setJoinCode(data?.join_code ?? null)
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
    if (data) setJoinCode(data.join_code)
  }, [leagueId])

  return { joinCode, generate }
}
