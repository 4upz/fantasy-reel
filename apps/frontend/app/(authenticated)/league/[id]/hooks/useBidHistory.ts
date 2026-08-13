'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { BidHistoryRound, CounterpickBid, PickupBid } from '@/types'
import { groupBidHistory } from '../components/bidHistory'

/**
 * Newest settled bids to pull per table. Well past a full season for a normal
 * league; a league that somehow exceeds it loses only its oldest rounds, since
 * both queries come back deadline-descending.
 */
const MAX_SETTLED_BIDS = 500

/** Bids that reached a result. Cancelled bids never competed, so they're out. */
const SETTLED_STATUSES = ['won', 'lost']

interface UseBidHistoryOptions {
  leagueId: string
}

interface UseBidHistoryReturn {
  rounds: BidHistoryRound[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Settled pickup and counterpick bids for the league, grouped into rounds.
 *
 * Deliberately outside useBidding and its realtime subscriptions: history only
 * moves when the process-bids cron runs, so a live channel would cost a
 * connection to watch something that changes weekly.
 */
export function useBidHistory({ leagueId }: UseBidHistoryOptions): UseBidHistoryReturn {
  const [pickupBids, setPickupBids] = useState<PickupBid[]>([])
  const [counterpickBids, setCounterpickBids] = useState<CounterpickBid[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [pickupResult, counterpickResult] = await Promise.all([
      supabase
        .from('pickup_bids')
        .select('*')
        .eq('league_id', leagueId)
        .in('status', SETTLED_STATUSES)
        .order('processing_deadline', { ascending: false })
        .limit(MAX_SETTLED_BIDS),
      supabase
        .from('counterpick_bids')
        .select('*, movies(title, poster_url, release_date, fantasy_points)')
        .eq('league_id', leagueId)
        .in('status', SETTLED_STATUSES)
        .order('processing_deadline', { ascending: false })
        .limit(MAX_SETTLED_BIDS),
    ])

    const failure = pickupResult.error ?? counterpickResult.error
    if (failure) {
      setError(failure.message)
    } else {
      setPickupBids(pickupResult.data ?? [])
      setCounterpickBids((counterpickResult.data as CounterpickBid[]) ?? [])
    }
    setLoading(false)
  }, [supabase, leagueId])

  useEffect(() => {
    refetch()
  }, [refetch])

  const rounds = useMemo(
    () => groupBidHistory(pickupBids, counterpickBids),
    [pickupBids, counterpickBids]
  )

  return { rounds, loading, error, refetch }
}
