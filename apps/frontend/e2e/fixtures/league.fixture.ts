import { test as authTest } from './auth.fixture'
import {
  createTestLeague,
  deleteTestLeague,
  addParticipant,
  createTeam,
  updateLeagueStatus,
  createTestMovie,
  createDraftPick,
  enableLeagueBidding,
  setTeamScore,
  getTeamId,
  TestLeague,
} from '../helpers/supabase.helper'

/**
 * Extended test with league fixtures
 * Provides pre-configured leagues for different test scenarios
 *
 * Best Practices Applied:
 * - Each fixture creates isolated test data
 * - Cleanup runs in finally blocks (runs even on failure)
 * - Uses service role for direct DB manipulation
 * - Fixtures can be composed (extend authTest)
 *
 * @see https://github.com/isaacharrisholt/supawright
 * @see https://fireship.io/courses/supabase/setup-playwright/
 */

interface LeagueFixtures {
  /** A basic league in setup status */
  testLeague: TestLeague
  /** A league ready for drafting (has participants and teams) */
  draftReadyLeague: TestLeague
  /** An active league (post-draft, has teams with movies) */
  activeLeague: TestLeague
  /** An active league with bidding enabled and team budgets */
  biddingLeague: TestLeague & { teamId: string; budget: number }
  /** An active league with drafted movies on multiple teams (for trading) */
  tradingLeague: TestLeague & {
    ownerTeamId: string
    testUserTeamId: string
    ownerMovieId: string
    testUserMovieId: string
  }
  /** An active league with teams and scores (for standings) */
  scoredLeague: TestLeague & {
    teams: Array<{ teamId: string; userId: string; score: number; name: string }>
  }
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

  /**
   * Bidding League Fixture
   * An active league with bidding enabled, team budgets, and pickup slots available.
   * Use for testing bid placement, cancellation, and outbid scenarios.
   */
  biddingLeague: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: `E2E Test Bidding League ${Date.now()}`,
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams with budgets
      await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const team = await createTeam(league.id, testUser.id, 'Test Team')

      // Enable bidding
      await enableLeagueBidding(league.id)

      await use({
        ...league,
        teamId: team.id,
        budget: 100, // Default FAAB budget
      })
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  /**
   * Trading League Fixture
   * An active league with drafted movies on multiple teams.
   * Use for testing trade proposals, responses, and vetoes.
   */
  tradingLeague: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: `E2E Test Trading League ${Date.now()}`,
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const testUserTeam = await createTeam(league.id, testUser.id, 'Test Team')

      // Create test movies
      const movie1 = await createTestMovie(99001, 'Trade Movie Alpha', '2025-06-15')
      const movie2 = await createTestMovie(99002, 'Trade Movie Beta', '2025-07-20')

      // Create draft picks (assign movies to teams)
      await createDraftPick(league.id, ownerTeam.id, movie1.id, 1, 1)
      await createDraftPick(league.id, testUserTeam.id, movie2.id, 2, 1)

      await use({
        ...league,
        ownerTeamId: ownerTeam.id,
        testUserTeamId: testUserTeam.id,
        ownerMovieId: movie1.id,
        testUserMovieId: movie2.id,
      })
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  /**
   * Scored League Fixture
   * An active league with multiple teams that have scores.
   * Use for testing standings display and score updates.
   */
  scoredLeague: async ({ leagueOwner, testUser, secondUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: `E2E Test Scored League ${Date.now()}`,
      status: 'active',
      maxParticipants: 4,
    })

    try {
      // Add participants
      await addParticipant(league.id, testUser.id)
      await addParticipant(league.id, secondUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const testUserTeam = await createTeam(league.id, testUser.id, 'Test Team')
      const secondUserTeam = await createTeam(league.id, secondUser.id, 'Second Team')

      // Set different scores for ranking tests
      await setTeamScore(ownerTeam.id, 150)
      await setTeamScore(testUserTeam.id, 120)
      await setTeamScore(secondUserTeam.id, 80)

      await use({
        ...league,
        teams: [
          { teamId: ownerTeam.id, userId: leagueOwner.id, score: 150, name: 'Owner Team' },
          { teamId: testUserTeam.id, userId: testUser.id, score: 120, name: 'Test Team' },
          { teamId: secondUserTeam.id, userId: secondUser.id, score: 80, name: 'Second Team' },
        ],
      })
    } finally {
      await deleteTestLeague(league.id)
    }
  },
})

// Re-export everything from auth fixture
export { expect, loginAs, logout } from './auth.fixture'
export type { TestUser } from '../helpers/supabase.helper'
export type { TestLeague } from '../helpers/supabase.helper'
