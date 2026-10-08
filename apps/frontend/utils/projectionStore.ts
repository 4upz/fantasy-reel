import { callEdgeFunction } from '@/utils/supabase/functions'
import { createClient } from '@/utils/supabase/client'
import type { GetMovieProjectionsResponse, MovieProjection } from '@/types'

/**
 * The projected-scores (Beta) store: per league, shared by every surface for
 * the life of the page. React reads it through `hooks/useMovieProjections`.
 *
 * It says nothing until `get-movie-projections` answers `enabled: true`. A
 * league the server keeps off, an error, a function that is not deployed, or
 * a request still in flight all read as "no projections", and a league that
 * answers off (or fails its first request) is never asked again.
 */

/** Matches the function's 1..100 id limit. */
const BATCH_SIZE = 100
const REQUEST_TIMEOUT_MS = 15_000

type Status = 'unknown' | 'enabled' | 'disabled'

interface LeagueStore {
  status: Status
  /** A null answer is real (no projection for that film); unknown ids are absent. */
  projections: Map<number, MovieProjection | null>
  pending: Set<number>
  inFlight: Set<number>
  /** The first request for a league whose status is unknown; the rest wait on it. */
  probing: boolean
  flushScheduled: boolean
}

const stores = new Map<string, LeagueStore>()
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

function storeFor(leagueId: string): LeagueStore {
  let store = stores.get(leagueId)
  if (!store) {
    store = {
      status: 'unknown',
      projections: new Map(),
      pending: new Set(),
      inFlight: new Set(),
      probing: false,
      flushScheduled: false,
    }
    stores.set(leagueId, store)
  }
  return store
}

function disable(store: LeagueStore): void {
  store.status = 'disabled'
  store.projections.clear()
  store.pending.clear()
}

async function loadBatch(leagueId: string, store: LeagueStore, ids: number[]): Promise<void> {
  ids.forEach((id) => store.inFlight.add(id))
  try {
    const { data, error } = await callEdgeFunction<GetMovieProjectionsResponse>('get-movie-projections', {
      body: { league_id: leagueId, tmdb_ids: ids },
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
    if (store.status === 'disabled') return
    if (data?.enabled === true) {
      store.status = 'enabled'
      ids.forEach((id) => store.projections.set(id, data.projections?.[String(id)] ?? null))
    } else if (data?.enabled === false || store.status === 'unknown') {
      // Off for this league, or the first request failed: stay dark for the page.
      disable(store)
    } else if (error) {
      // A later batch failing settles its ids as "no projection" rather than
      // retrying on every render; the rest of the league keeps what it has.
      ids.forEach((id) => store.projections.set(id, null))
    }
  } finally {
    ids.forEach((id) => store.inFlight.delete(id))
    store.probing = false
    notify()
    scheduleFlush(leagueId, store)
  }
}

function flush(leagueId: string, store: LeagueStore): void {
  store.flushScheduled = false
  if (store.status === 'disabled') {
    store.pending.clear()
    return
  }
  if (store.probing) return
  const missing = [...store.pending].filter((id) => !store.projections.has(id) && !store.inFlight.has(id))
  store.pending.clear()
  if (missing.length === 0) return
  if (store.status === 'unknown') {
    // One request decides whether the league has projections at all; a league
    // that doesn't never sees a second.
    store.probing = true
    missing.slice(BATCH_SIZE).forEach((id) => store.pending.add(id))
    void loadBatch(leagueId, store, missing.slice(0, BATCH_SIZE))
    return
  }
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    void loadBatch(leagueId, store, missing.slice(i, i + BATCH_SIZE))
  }
}

/** Collects every id asked for in the same tick into one request. */
function scheduleFlush(leagueId: string, store: LeagueStore): void {
  if (store.flushScheduled || store.pending.size === 0) return
  store.flushScheduled = true
  queueMicrotask(() => flush(leagueId, store))
}

/** Asks for any of these movies' projections not already known or on the way. */
export function requestProjections(leagueId: string, tmdbIds: readonly number[]): void {
  const store = storeFor(leagueId)
  if (store.status === 'disabled') return
  tmdbIds.forEach((id) => {
    if (Number.isInteger(id) && id > 0 && !store.projections.has(id)) store.pending.add(id)
  })
  scheduleFlush(leagueId, store)
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `movies.id` -> TMDb id, for rows that only carry the former. A movie's TMDb id never changes. */
const tmdbIdByMovieId = new Map<string, number>()
const pendingMovieIds = new Set<string>()
const lookedUpMovieIds = new Set<string>()
let movieLookupScheduled = false

async function lookUpMovieIds(): Promise<void> {
  movieLookupScheduled = false
  const ids = [...pendingMovieIds]
  pendingMovieIds.clear()
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const { data } = await createClient().from('movies').select('id, tmdb_id').in('id', ids.slice(i, i + BATCH_SIZE))
    ;(data ?? []).forEach((row: { id: string; tmdb_id: number }) => tmdbIdByMovieId.set(row.id, row.tmdb_id))
  }
  notify()
}

/** Looks up the TMDb ids of these movies, once each, in one query per tick. */
export function resolveMovieIds(movieIds: readonly string[]): void {
  movieIds.forEach((id) => {
    if (lookedUpMovieIds.has(id)) return
    lookedUpMovieIds.add(id)
    pendingMovieIds.add(id)
  })
  if (movieLookupScheduled || pendingMovieIds.size === 0) return
  movieLookupScheduled = true
  queueMicrotask(() => void lookUpMovieIds())
}

export function tmdbIdForMovie(movieId: string): number | undefined {
  return tmdbIdByMovieId.get(movieId)
}

/** Bumps on every store change; the React snapshot. */
export const getVersion = (): number => version

/** A league's loaded projections, or null unless the server has switched them on for it. */
export function enabledProjections(leagueId: string): ReadonlyMap<number, MovieProjection | null> | null {
  const store = stores.get(leagueId)
  return store?.status === 'enabled' ? store.projections : null
}

/** The league answered off (or failed): nothing about projections should be fetched for it. */
export function projectionsDisabled(leagueId: string): boolean {
  return stores.get(leagueId)?.status === 'disabled'
}

/** Test seam: forget every league, as a fresh page would. */
export function resetProjectionStore(): void {
  stores.clear()
  tmdbIdByMovieId.clear()
  lookedUpMovieIds.clear()
  version = 0
}
