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
  createTeamBudget,
  setTeamScore,
  getTeamId,
  createPickupBid,
  createTradeOffer,
  createMovieReviews,
  setDraftOrder,
  TestLeague,
} from '../helpers/supabase.helper'
import { uniqueTmdbId, uniqueLeagueName } from '../helpers/test-ids.helper'

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
  /** An active league with bidding enabled and an existing active bid */
  biddingLeagueWithBid: TestLeague & {
    teamId: string
    budget: number
    bidId: string
    bidTmdbId: number
    bidMovieTitle: string
  }
  /** An active league with drafted movies on multiple teams (for trading) */
  tradingLeague: TestLeague & {
    ownerTeamId: string
    testUserTeamId: string
    ownerMovieId: string
    testUserMovieId: string
  }
  /** An active league with a pending trade offer */
  tradingLeagueWithTrade: TestLeague & {
    ownerTeamId: string
    testUserTeamId: string
    ownerMovieId: string
    testUserMovieId: string
    tradeOfferId: string
  }
  /** An active league with teams and scores (for standings) */
  scoredLeague: TestLeague & {
    teams: Array<{ teamId: string; userId: string; score: number; name: string }>
  }
  /** An active league with teams, scores, and movie-level reviews */
  scoredLeagueWithReviews: TestLeague & {
    teams: Array<{
      teamId: string
      userId: string
      score: number
      name: string
      movieId: string
      movieTitle: string
    }>
  }
  /** Two leagues where testUser is a participant (for league switcher tests) */
  multiLeague: {
    league1: { id: string; name: string; status: TestLeague['status'] }
    league2: { id: string; name: string; status: TestLeague['status'] }
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
      name: uniqueLeagueName('E2E Draft Ready'),
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

      // Set draft order (required for DraftBoard turn calculation)
      await setDraftOrder(league.id, leagueOwner.id, 1)
      await setDraftOrder(league.id, testUser.id, 2)
      await setDraftOrder(league.id, secondUser.id, 3)

      await use(league)
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  // Active league for bidding/trading tests
  activeLeague: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Active'),
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
      name: uniqueLeagueName('E2E Bidding'),
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const team = await createTeam(league.id, testUser.id, 'Test Team')

      // Enable bidding
      await enableLeagueBidding(league.id)

      // Create team_budgets rows (required by place-bid edge function)
      await createTeamBudget(ownerTeam.id, 100)
      await createTeamBudget(team.id, 100)

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
      name: uniqueLeagueName('E2E Trading'),
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const testUserTeam = await createTeam(league.id, testUser.id, 'Test Team')

      // Create test movies with worker-unique TMDB IDs
      const movie1 = await createTestMovie(uniqueTmdbId(1), 'Trade Movie Alpha', '2025-06-15')
      const movie2 = await createTestMovie(uniqueTmdbId(2), 'Trade Movie Beta', '2025-07-20')

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
      name: uniqueLeagueName('E2E Scored'),
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

  /**
   * Bidding League With Existing Bid Fixture
   * An active league with bidding enabled and an existing active bid.
   * Use for testing bid cancellation and counter-bid scenarios.
   */
  biddingLeagueWithBid: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Bidding With Bid'),
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const team = await createTeam(league.id, testUser.id, 'Test Team')

      // Enable bidding
      await enableLeagueBidding(league.id)

      // Create team_budgets rows (required by place-bid edge function)
      await createTeamBudget(ownerTeam.id, 100)
      await createTeamBudget(team.id, 100)

      // Create an active bid with worker-unique TMDB ID
      const bidTmdbId = uniqueTmdbId(101)
      const bidMovieTitle = 'Test Bid Movie'
      const bid = await createPickupBid(
        league.id,
        team.id,
        bidTmdbId,
        15, // $15 bid
        {
          title: bidMovieTitle,
          releaseDate: '2025-08-15',
        }
      )

      await use({
        ...league,
        teamId: team.id,
        budget: 100,
        bidId: bid.id,
        bidTmdbId,
        bidMovieTitle,
      })
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  /**
   * Trading League With Pending Trade Fixture
   * An active league with a pending trade offer from owner to testUser.
   * Use for testing trade responses (accept, reject, counter).
   */
  tradingLeagueWithTrade: async ({ leagueOwner, testUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Trading With Trade'),
      status: 'active',
    })

    try {
      // Add participant
      await addParticipant(league.id, testUser.id)

      // Create teams
      const ownerTeam = await createTeam(league.id, leagueOwner.id, 'Owner Team')
      const testUserTeam = await createTeam(league.id, testUser.id, 'Test Team')

      // Create test movies with worker-unique TMDB IDs
      const movie1 = await createTestMovie(uniqueTmdbId(11), 'Trade Offer Movie Alpha', '2025-06-15')
      const movie2 = await createTestMovie(uniqueTmdbId(12), 'Trade Offer Movie Beta', '2025-07-20')

      // Create draft picks (assign movies to teams)
      await createDraftPick(league.id, ownerTeam.id, movie1.id, 1, 1)
      await createDraftPick(league.id, testUserTeam.id, movie2.id, 2, 1)

      // Create pending trade offer from owner to testUser
      // Trade items are now embedded directly in the trade_offers table
      const tradeOffer = await createTradeOffer(
        league.id,
        ownerTeam.id,
        testUserTeam.id,
        { movies: [{ movie_id: movie1.id, source: 'draft_pick' }], faab: 0 },
        { movies: [{ movie_id: movie2.id, source: 'draft_pick' }], faab: 0 }
      )

      await use({
        ...league,
        ownerTeamId: ownerTeam.id,
        testUserTeamId: testUserTeam.id,
        ownerMovieId: movie1.id,
        testUserMovieId: movie2.id,
        tradeOfferId: tradeOffer.id,
      })
    } finally {
      await deleteTestLeague(league.id)
    }
  },

  /**
   * Multi-League Fixture
   * Two leagues where testUser is a participant in both.
   * League 1 is active, League 2 is in setup status.
   * Use for testing league switcher dropdown.
   */
  multiLeague: async ({ leagueOwner, testUser }, use) => {
    const league1 = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Multi Active'),
      status: 'active',
    })

    const league2 = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Multi Setup'),
      status: 'setup',
    })

    try {
      // Add testUser as participant in both leagues
      await addParticipant(league1.id, testUser.id)
      await addParticipant(league2.id, testUser.id)

      // Create teams for testUser in both leagues
      await createTeam(league1.id, leagueOwner.id, 'Owner Team L1')
      await createTeam(league1.id, testUser.id, 'Test Team L1')
      await createTeam(league2.id, leagueOwner.id, 'Owner Team L2')
      await createTeam(league2.id, testUser.id, 'Test Team L2')

      await use({
        league1: { id: league1.id, name: league1.name, status: league1.status },
        league2: { id: league2.id, name: league2.name, status: league2.status },
      })
    } finally {
      await deleteTestLeague(league1.id)
      await deleteTestLeague(league2.id)
    }
  },

  /**
   * Scored League With Reviews Fixture
   * An active league with teams, scores, and movie-level review data.
   * Use for testing detailed score breakdowns and review displays.
   */
  scoredLeagueWithReviews: async ({ leagueOwner, testUser, secondUser }, use) => {
    const league = await createTestLeague(leagueOwner.id, {
      name: uniqueLeagueName('E2E Scored With Reviews'),
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

      // Create movies with reviews using worker-unique TMDB IDs
      const movie1 = await createTestMovie(uniqueTmdbId(21), 'Scored Movie Alpha', '2025-01-15', {
        status: 'released',
      })
      const movie2 = await createTestMovie(uniqueTmdbId(22), 'Scored Movie Beta', '2025-02-20', {
        status: 'released',
      })
      const movie3 = await createTestMovie(uniqueTmdbId(23), 'Scored Movie Gamma', '2025-03-25', {
        status: 'released',
      })

      // Create draft picks
      await createDraftPick(league.id, ownerTeam.id, movie1.id, 1, 1)
      await createDraftPick(league.id, testUserTeam.id, movie2.id, 2, 1)
      await createDraftPick(league.id, secondUserTeam.id, movie3.id, 3, 1)

      // Create reviews for each movie
      await createMovieReviews(movie1.id, { imdb: 85, rottenTomatoes: 90, metacritic: 82 })
      await createMovieReviews(movie2.id, { imdb: 75, rottenTomatoes: 80, metacritic: 72 })
      await createMovieReviews(movie3.id, { imdb: 60, rottenTomatoes: 65, metacritic: 58 })

      // Set team scores based on reviews
      await setTeamScore(ownerTeam.id, 150)
      await setTeamScore(testUserTeam.id, 120)
      await setTeamScore(secondUserTeam.id, 80)

      await use({
        ...league,
        teams: [
          {
            teamId: ownerTeam.id,
            userId: leagueOwner.id,
            score: 150,
            name: 'Owner Team',
            movieId: movie1.id,
            movieTitle: 'Scored Movie Alpha',
          },
          {
            teamId: testUserTeam.id,
            userId: testUser.id,
            score: 120,
            name: 'Test Team',
            movieId: movie2.id,
            movieTitle: 'Scored Movie Beta',
          },
          {
            teamId: secondUserTeam.id,
            userId: secondUser.id,
            score: 80,
            name: 'Second Team',
            movieId: movie3.id,
            movieTitle: 'Scored Movie Gamma',
          },
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
