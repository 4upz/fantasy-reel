import { test as authTest } from './auth.fixture'
import {
  createTestLeague,
  deleteTestLeague,
  addParticipant,
  createTeam,
  updateLeagueStatus,
  TestLeague,
} from '../helpers/supabase.helper'

/**
 * Extended test with league fixtures
 * Provides pre-configured leagues for different test scenarios
 */

interface LeagueFixtures {
  /** A basic league in setup status */
  testLeague: TestLeague
  /** A league ready for drafting (has participants and teams) */
  draftReadyLeague: TestLeague
  /** An active league (post-draft, has teams with movies) */
  activeLeague: TestLeague
}

export const test = authTest.extend<LeagueFixtures>({
  // Basic league in setup status
  testLeague: async ({ leagueOwner }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      status: 'setup',
    })
    await use(league)
    await deleteTestLeague(league.id)
  },

  // League with multiple participants ready to draft
  draftReadyLeague: async ({ leagueOwner, testUser, secondUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: `E2E Test League Draft Ready ${Date.now()}`,
      status: 'setup',
      maxParticipants: 4,
    })

    try {
      // Add participants
      await addParticipant(league.id, testUser.id)
      await addParticipant(league.id, secondUser.id)

      // Create teams for all participants
      await createTeam(league.id, leagueOwner.id, 'Owner Team')
      await createTeam(league.id, testUser.id, 'Test Team')
      await createTeam(league.id, secondUser.id, 'Second Team')

      await use(league)
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  // Active league for bidding/trading tests
  activeLeague: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: `E2E Test League Active ${Date.now()}`,
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      await createTeam(league.id, leagueOwner.id, 'Owner Team')
      await createTeam(league.id, testUser.id, 'Test Team')

      await use(league)
    } finally {
      await deleteTestLeague(league.id)
    }
  },
})

// Re-export everything from auth fixture
export { expect, loginAs, logout } from './auth.fixture'
export type { TestUser } from '../helpers/supabase.helper'
export type { TestLeague } from '../helpers/supabase.helper'
