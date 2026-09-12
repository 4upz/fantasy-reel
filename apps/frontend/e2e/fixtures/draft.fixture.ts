import { randomInt, randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TMDbSearchResult } from '@/types'
import { test as leagueTest, expect } from './league.fixture'
import { daysFromNow } from './test-data'
import { getAdminClient } from '../helpers/supabase.helper'
import { seedDraftMovieCache, seedDraftSearch } from '../helpers/draft-cache.helper'

interface ReadyDraft {
  id: string
  query: string
  movies: TMDbSearchResult[]
  teamIds: string[]
}

export const test = leagueTest.extend<{ readyDraft: ReadyDraft }>({
  readyDraft: async ({ draftReadyLeague }, provideFixture) => {
    const admin = getAdminClient()
    const query = `readiness-${randomUUID()}`
    const tmdbIdBase = randomInt(1_500_000_000, 2_000_000_000 - 4)
    const movies = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((title, index) => ({
      tmdb_id: tmdbIdBase + index, title: `${query} ${title}`,
      overview: 'A canonical cached movie for draft readiness verification.',
      release_date: daysFromNow(30 + index), poster_url: null, vote_average: 8.7,
      popularity: 1, genre_ids: [28],
    }))
    const keys: string[] = []
    try {
      const { error } = await admin.from('leagues').update({
        draft_slots: 1, draft_counterpick_slots: 1, faab_budget: 137, custom_draft_order: true,
      }).eq('id', draftReadyLeague.id)
      if (error) throw error
      keys.push(...await seedDraftMovieCache(movies))
      keys.push(...await seedDraftSearch(query, [movies]))
      const { data: participants, error: participantError } = await admin.from('league_participants')
        .select('teams(id)').eq('league_id', draftReadyLeague.id).order('draft_order')
      if (participantError) throw participantError
      const teamIds = (participants ?? []).map(row => (row.teams as unknown as { id: string }).id)
      await provideFixture({ id: draftReadyLeague.id, query, movies, teamIds })
    } finally {
      const cleanupErrors: unknown[] = []
      try {
        // The outer fixture also cleans up; deleting here releases movie FKs first.
        const { error: leagueError } = await admin.from('leagues').delete().eq('id', draftReadyLeague.id)
        if (leagueError) throw leagueError
        const { error: movieError } = await admin.from('movies').delete().in('tmdb_id', movies.map(movie => movie.tmdb_id))
        if (movieError) throw movieError
      } catch (error) {
        cleanupErrors.push(error)
      }
      // Cache cleanup is independent of fixture row deletion and must still run
      // after a database timeout. Preserve every failure for the test report.
      try {
        if (keys.length) {
          const { error: cacheError } = await admin.from('tmdb_cache').delete().in('cache_key', keys)
          if (cacheError) throw cacheError
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Could not clean draft test fixtures')
    }
  },
})

export async function openDraft(page: Page, draft: ReadyDraft) {
  await page.goto(`/league/${draft.id}/draft`)
}

export async function startDraft(page: Page, draft: ReadyDraft) {
  await openDraft(page, draft)
  await page.getByTestId('start-draft-button').click()
  await expect(page.getByTestId('draft-board')).toBeVisible()
  await expect(page.getByTestId('draft-connection-status')).toHaveText('Live')
}

export async function searchDraft(page: Page, draft: ReadyDraft, query = draft.query) {
  await page.getByTestId('movie-search-input').fill(query)
  const expectedCards = draft.movies.map(movie => `[data-testid="preview-movie-${movie.tmdb_id}"]`).join(',')
  await expect(page.locator(expectedCards).first()).toBeVisible()
}

export async function pickMovie(page: Page, movie: TMDbSearchResult) {
  await page.getByTestId(`preview-movie-${movie.tmdb_id}`).click()
  await expect(page.getByTestId('draft-movie-button')).toBeEnabled()
  await page.getByTestId('draft-movie-button').click()
  await expect(page.getByTestId('movie-quick-preview')).toHaveCount(0)
}

export async function readDraftPicks(leagueId: string) {
  const { data, error } = await getAdminClient().from('draft_picks')
    .select('id,team_id,movie_id,round,pick_number,movies(title,tmdb_id)').eq('league_id', leagueId)
  if (error) throw error
  return data ?? []
}

export { expect }
