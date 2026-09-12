import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import path from 'path'
import type { TMDbSearchResult } from '@/types'
import { getAdminClient } from './supabase.helper'

function cacheKey(namespace: string, params: Record<string, string | number>) {
  return `${namespace}:${Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
}

export async function seedCacheRows(rows: ReadonlyArray<{ cache_key: string; payload: unknown }>): Promise<string[]> {
  const now = Date.now()
  const { error } = await getAdminClient().from('tmdb_cache').upsert(rows.map(row => ({
    ...row, fetched_at: new Date(now).toISOString(), expires_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
  })))
  if (error) throw new Error(`Could not seed trusted movie cache: ${error.message}`)
  return rows.map(row => row.cache_key)
}

/** Seed the same canonical details consumed by previews and draft-pick. */
export function seedDraftMovieCache(movies: readonly TMDbSearchResult[], options: { status?: string } = {}) {
  return seedCacheRows(movies.flatMap(movie => [
    { cache_key: cacheKey('movie_details', { tmdb_id: movie.tmdb_id }), payload: {
      ...movie, imdb_id: null, tagline: null, runtime: null, status: options.status ?? 'Post Production',
      backdrop_url: null, vote_count: 87654, genres: [], cast: [], director: null,
    } },
    { cache_key: cacheKey('movie_collection', { tmdb_id: movie.tmdb_id }), payload: {
      tmdb_id: movie.tmdb_id, release_date: movie.release_date, collection_id: null, collection_name: null,
    } },
  ]))
}

export function seedDraftSearch(query: string, pages: ReadonlyArray<readonly TMDbSearchResult[]>) {
  return seedCacheRows(pages.map((results, index) => ({
    cache_key: cacheKey('search', { include_adult: 'false', language: 'en-US', page: index + 1, query: query.trim().toLowerCase() }),
    payload: { page: index + 1, total_pages: pages.length, total_results: pages.flat().length, results },
  })))
}

/** Default browse is shared and deterministic; each test searches its unique cache key. */
export function seedDefaultDraftBrowse(movies: readonly TMDbSearchResult[]) {
  const today = new Date().toISOString().slice(0, 10)
  const yearEnd = `${new Date().getUTCFullYear()}-12-31`
  return seedCacheRows([{ cache_key: cacheKey('browse', {
    include_adult: 'false', include_video: 'false', language: 'en-US', page: 1,
    'primary_release_date.gte': today, 'primary_release_date.lte': yearEnd, region: 'US',
    sort_by: 'popularity.desc', with_release_type: '2|3',
  }), payload: { page: 1, total_pages: 1, total_results: movies.length,
    results: movies.filter(movie => movie.release_date && movie.release_date <= yearEnd) } }])
}

// Outside outputDir so the next setup can clean an interrupted run even after
// Playwright clears test-results. This directory is already ignored by Git.
const globalCacheManifest = path.resolve(__dirname, '../../playwright/.cache/draft-cache-keys.json')

export function rememberGlobalDraftCache(keys: string[]): void {
  mkdirSync(path.dirname(globalCacheManifest), { recursive: true })
  writeFileSync(globalCacheManifest, JSON.stringify(keys))
}

export async function clearGlobalDraftCache(): Promise<void> {
  if (!existsSync(globalCacheManifest)) return
  const keys: string[] = JSON.parse(readFileSync(globalCacheManifest, 'utf8'))
  if (keys.length) {
    const { error } = await getAdminClient().from('tmdb_cache').delete().in('cache_key', keys)
    if (error) throw new Error(`Could not clean movie cache fixtures: ${error.message}`)
  }
  unlinkSync(globalCacheManifest)
}
