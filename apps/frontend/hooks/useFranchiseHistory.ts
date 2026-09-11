import { useEffect, useMemo, useReducer } from 'react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import type { FranchiseHistory } from '@/types'

/** Matches MAX_IDS_PER_REQUEST in get-franchise-history. */
const BATCH_SIZE = 40

/**
 * Loaded histories, shared by every surface for the life of the page. A
 * movie's franchise never changes and its history is cached server-side for
 * a week, so there is nothing to invalidate: once known, it is known.
 *
 * `null` is a real answer (standalone movie, or the first of its series), so
 * "unknown" is "not in the map" rather than a null value.
 */
const histories = new Map<number, FranchiseHistory | null>()
const inFlight = new Set<number>()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

async function loadBatch(tmdbIds: number[]): Promise<void> {
  tmdbIds.forEach((id) => inFlight.add(id))
  try {
    const { data } = await callEdgeFunction<{ histories: Record<string, FranchiseHistory | null> }>(
      'get-franchise-history',
      { body: { tmdb_ids: tmdbIds } }
    )
    // A failed batch settles as "no history" rather than retrying on every
    // render: the line is context, not something worth hammering the API for.
    tmdbIds.forEach((id) => histories.set(id, data?.histories[String(id)] ?? null))
  } finally {
    tmdbIds.forEach((id) => inFlight.delete(id))
    notify()
  }
}

function requestMissing(tmdbIds: number[]): void {
  const missing = tmdbIds.filter((id) => !histories.has(id) && !inFlight.has(id))
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    void loadBatch(missing.slice(i, i + BATCH_SIZE))
  }
}

/**
 * Franchise histories for a set of movies, fetched in batches and shared
 * across components. Ids the store has not answered yet are absent from the
 * returned map; standalone movies map to null.
 */
export function useFranchiseHistories(tmdbIds: number[]): ReadonlyMap<number, FranchiseHistory | null> {
  const [tick, rerender] = useReducer((n: number) => n + 1, 0)
  // Callers pass fresh arrays on every render; the joined key is what is stable,
  // so the ids the rest of the hook works from are rebuilt from it.
  const key = tmdbIds.join(',')
  const ids = useMemo(() => (key ? key.split(',').map(Number) : []), [key])

  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])

  useEffect(() => {
    requestMissing(ids)
  }, [ids])

  return useMemo(() => {
    const snapshot = new Map<number, FranchiseHistory | null>()
    for (const id of ids) {
      if (histories.has(id)) snapshot.set(id, histories.get(id) ?? null)
    }
    return snapshot
    // `tick` is what makes a store update reach this snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, tick])
}

interface UseFranchiseHistoryReturn {
  history: FranchiseHistory | null
  isLoading: boolean
}

/** One movie's franchise history; `null` when it has none. */
export function useFranchiseHistory(tmdbId: number | null | undefined): UseFranchiseHistoryReturn {
  const ids = useMemo(() => (tmdbId != null ? [tmdbId] : []), [tmdbId])
  const snapshot = useFranchiseHistories(ids)
  if (tmdbId == null) return { history: null, isLoading: false }
  return {
    history: snapshot.get(tmdbId) ?? null,
    isLoading: !snapshot.has(tmdbId),
  }
}
