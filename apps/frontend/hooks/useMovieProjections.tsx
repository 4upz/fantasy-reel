'use client'

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  enabledProjections,
  getVersion,
  projectionsDisabled,
  requestProjections,
  resolveMovieIds,
  subscribe,
  tmdbIdForMovie,
} from '@/utils/projectionStore'
import type { MovieProjection } from '@/types'

/**
 * Projected scores (Beta) for React. Everything user-visible about
 * projections hangs off these hooks, and they return nothing unless the
 * league's projections are switched on and loaded -- so with the feature off,
 * on an error, or while loading, every surface renders exactly what it did
 * before projections existed.
 */

/** Server and hydration renders see no projections, so the markup matches today's. */
const getServerVersion = () => 0

const ProjectionsLeagueContext = createContext<string | null>(null)

/**
 * Marks a subtree as a league context. Outside one, every projection hook is
 * inert and no request is ever made.
 */
export function ProjectionsProvider({ leagueId, children }: { leagueId: string; children: React.ReactNode }) {
  return <ProjectionsLeagueContext.Provider value={leagueId}>{children}</ProjectionsLeagueContext.Provider>
}

/** The league whose projections this subtree reads, or null outside a league. */
export function useProjectionsLeagueId(): string | null {
  return useContext(ProjectionsLeagueContext)
}

function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion)
}

/** True once the league's projections have been switched on and loaded. */
export function useProjectionsEnabled(): boolean {
  const leagueId = useProjectionsLeagueId()
  const current = useStoreVersion()
  return current > 0 && leagueId != null && enabledProjections(leagueId) != null
}

/**
 * Projections for a set of movies in this league, requested in batches and
 * shared across components. Empty unless the league has projections on; ids
 * the server has no projection for map to null, ids not answered yet are absent.
 */
export function useMovieProjections(tmdbIds: readonly number[]): ReadonlyMap<number, MovieProjection | null> {
  const leagueId = useProjectionsLeagueId()
  const current = useStoreVersion()
  // Callers pass fresh arrays on every render; the joined key is what is stable.
  const key = tmdbIds.join(',')
  const ids = useMemo(() => (key ? key.split(',').map(Number) : []), [key])

  useEffect(() => {
    if (leagueId && ids.length > 0) requestProjections(leagueId, ids)
  }, [leagueId, ids])

  return useMemo(() => {
    const snapshot = new Map<number, MovieProjection | null>()
    const loaded = leagueId && current > 0 ? enabledProjections(leagueId) : null
    if (!loaded) return snapshot
    for (const id of ids) {
      if (loaded.has(id)) snapshot.set(id, loaded.get(id) ?? null)
    }
    return snapshot
  }, [leagueId, ids, current])
}

/**
 * Projections keyed by `movies.id`, for rows (counterpick options, trade
 * offer items) that do not carry a TMDb id. The ids are resolved from the
 * public `movies` table first -- batched across the page, and skipped
 * entirely once the league has answered off.
 */
export function useMovieProjectionsByMovieId(movieIds: readonly string[]): ReadonlyMap<string, MovieProjection | null> {
  const leagueId = useProjectionsLeagueId()
  const current = useStoreVersion()
  const key = [...new Set(movieIds)].sort().join(',')

  useEffect(() => {
    if (leagueId && key && !projectionsDisabled(leagueId)) resolveMovieIds(key.split(','))
  }, [leagueId, key])

  const pairs = useMemo(
    () =>
      (key ? key.split(',') : []).flatMap((movieId) => {
        const tmdbId = tmdbIdForMovie(movieId)
        return tmdbId == null ? [] : [[movieId, tmdbId] as const]
      }),
    // `current` is what makes a finished lookup reach this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, current]
  )
  const byTmdbId = useMovieProjections(pairs.map(([, tmdbId]) => tmdbId))

  return useMemo(() => {
    const snapshot = new Map<string, MovieProjection | null>()
    for (const [movieId, tmdbId] of pairs) {
      if (byTmdbId.has(tmdbId)) snapshot.set(movieId, byTmdbId.get(tmdbId) ?? null)
    }
    return snapshot
  }, [pairs, byTmdbId])
}

/** One movie's projection, or null when there is none to show. */
export function useMovieProjection(tmdbId: number | null | undefined): MovieProjection | null {
  const ids = useMemo(() => (tmdbId != null ? [tmdbId] : []), [tmdbId])
  const snapshot = useMovieProjections(ids)
  return tmdbId != null ? snapshot.get(tmdbId) ?? null : null
}
