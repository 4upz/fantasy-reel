import { test, expect } from '../../fixtures/league.fixture'
import { setupAllMocks, MOCK_MOVIES } from '../../helpers/mock-api.helper'
import { getAdminClient, updateLeagueStatus } from '../../helpers/supabase.helper'

// This file runs only in the mobile-chrome project, including the regular CI suite.
test.describe('Phone release checks @mobile @critical', () => {
  test('bottom navigation opens standings and expands a roster', async ({ authedPage, scoredLeagueWithReviews }) => {
    await authedPage.goto(`/league/${scoredLeagueWithReviews.id}/dashboard`)
    const navigation = authedPage.getByTestId('league-bottom-nav')
    await expect(navigation).toBeVisible()
    await navigation.getByRole('link', { name: 'Standings', exact: true }).click()
    await expect(navigation.getByRole('link', { name: 'Standings', exact: true })).toHaveAttribute('aria-current', 'page')
    const team = scoredLeagueWithReviews.teams[0]
    await authedPage.getByTestId(`team-row-${team.teamId}`).click()
    await expect(authedPage.getByTestId('standings-container').getByText(team.movieTitle, { exact: true })).toBeVisible()
  })

  test('owner selects and drafts a movie on a phone', async ({ leagueOwnerPage: page, draftReadyLeague }) => {
    await setupAllMocks(page)
    await updateLeagueStatus(draftReadyLeague.id, 'drafting')
    await page.goto(`/league/${draftReadyLeague.id}/draft`)
    await expect(page.getByText("It's your turn!")).toBeVisible()
    await page.getByTestId(`movie-card-${MOCK_MOVIES[0].tmdb_id}`).click()
    await page.getByTestId('draft-movie-button').click()
    await expect.poll(async () => {
      const { data, error } = await getAdminClient().from('draft_picks').select('id').eq('league_id', draftReadyLeague.id)
      if (error) throw error
      return data.length
    }).toBe(1)
    await expect(page.getByText("Test Team's pick")).toBeVisible()
  })

  test('bid modal submits a real bid on a phone', async ({ authedPage: page, biddingLeague }) => {
    await setupAllMocks(page)
    await page.goto(`/league/${biddingLeague.id}/bidding`)
    await page.getByTestId('place-bid-button').click()
    await page.getByTestId('bid-movie-search-input').fill('Alpha')
    await page.getByTestId(`bid-movie-result-${MOCK_MOVIES[0].tmdb_id}`).click()
    await page.getByTestId('bid-amount-input').fill('10')
    await page.getByTestId('submit-bid-button').click()
    await expect(page.getByTestId('submit-bid-button')).not.toBeVisible()
    await expect(page.getByTestId(`bid-card-${MOCK_MOVIES[0].tmdb_id}`)).toBeVisible()
    const { data, error } = await getAdminClient().from('pickup_bids').select('amount').eq('league_id', biddingLeague.id).eq('team_id', biddingLeague.teamId).single()
    expect(error).toBeNull()
    expect(data?.amount).toBe(10)
  })

  test('recipient confirms a trade on a phone', async ({ authedPage: page, tradingLeagueWithTrade: league }) => {
    await page.goto(`/league/${league.id}/trading`)
    await page.getByTestId(`accept-trade-${league.tradeOfferId}`).click()
    await page.getByRole('button', { name: /confirm accept/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect.poll(async () => {
      const { data, error } = await getAdminClient().from('trade_offers').select('status').eq('id', league.tradeOfferId).single()
      if (error) throw error
      return data.status
    }).toMatch(/^(accepted|review|completed)$/)
    await expect(page.getByTestId(`accept-trade-${league.tradeOfferId}`)).not.toBeVisible()
  })
})
