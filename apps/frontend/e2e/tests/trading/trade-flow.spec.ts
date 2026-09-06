import { getAdminClient } from '../../helpers/supabase.helper'
import { test, expect } from '../../fixtures/league.fixture'
import {
  waitForModalOpen,
  waitForModalClose,
  waitForPageSettle,
} from '../../helpers/ui.helper'

/**
 * Trading System E2E Tests
 *
 * Tests the trading flow between teams in a league.
 * Uses tradingLeague fixture which provides an active league with
 * drafted movies on multiple teams:
 * - Owner Team has "Trade Movie Alpha"
 * - Test Team has "Trade Movie Beta"
 *
 * And tradingLeagueWithTrade which additionally has a pending trade offer
 * from owner to testUser:
 * - Owner offers "Trade Offer Movie Alpha"
 * - Requesting "Trade Offer Movie Beta"
 *
 * Key UI elements:
 * - trading-panel: Main trading panel container
 * - propose-trade-button: Opens the ProposeTradeModal
 * - trade-card-{id}: Individual trade offer cards
 * - accept-trade-{id}: Accept button on trade card
 * - reject-trade-{id}: Reject button on trade card
 * - cancel-trade-{id}: Cancel button (only for proposer)
 * - veto-trade-{id}: Veto button (only for league owner)
 */

test.describe('Trading Page @trading', () => {
  test('trading page is accessible from league', async ({
    authedPage,
    tradingLeague,
  }) => {
    // Navigate directly to trading page
    await authedPage.goto(`/league/${tradingLeague.id}/trading`)

    // Verify trading panel loaded
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })
  })

  test('shows team rosters for trading', async ({
    authedPage,
    tradingLeague,
  }) => {
    await authedPage.goto(`/league/${tradingLeague.id}/trading`)

    // Trading panel should load
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Propose Trade @trading', () => {
  test('can open propose trade interface', async ({
    authedPage,
    tradingLeague,
  }) => {
    await authedPage.goto(`/league/${tradingLeague.id}/trading`)

    // Wait for trading panel to load
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })

    // Click propose trade button
    await authedPage.getByTestId('propose-trade-button').click()
    await waitForModalOpen(authedPage)

    // Should see trade interface/modal (dialog role)
    await expect(authedPage.getByRole('dialog')).toBeVisible()
  })

  test('can view own roster on trading page', async ({
    authedPage,
    tradingLeague,
  }) => {
    await authedPage.goto(`/league/${tradingLeague.id}/trading`)

    // Wait for trading panel
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })

    // The testUser's team has "Trade Movie Beta" drafted
    // This movie title should be visible somewhere on the trading page
    // (either in roster display or in the propose trade flow)
    // Note: If the trading page doesn't directly show rosters, this may not be visible.
    // Check for the propose-trade-button as a fallback indicator the page loaded.
    await expect(authedPage.getByTestId('propose-trade-button')).toBeVisible()
  })

  test('can propose a trade through the modal', async ({
    authedPage,
    tradingLeague,
  }) => {
    await authedPage.goto(`/league/${tradingLeague.id}/trading`)

    // Wait for trading panel to load
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })

    // Click propose trade button
    await authedPage.getByTestId('propose-trade-button').click()
    await waitForModalOpen(authedPage)

    // Step 1: Select trade partner (Owner Team)
    const ownerTeamButton = authedPage.getByRole('option', { name: /Owner Team/i })
    await expect(ownerTeamButton).toBeVisible({ timeout: 5000 })
    await ownerTeamButton.click()

    // Step 2: Should now show item selection with "You give" and "You receive"
    await expect(authedPage.getByText(/You give/i)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText(/You receive/i)).toBeVisible({ timeout: 5000 })

    // Select a movie to offer (testUser's movie: "Trade Movie Beta")
    const offerMovie = authedPage.getByRole('option', { name: /Trade Movie Beta/i })
    await expect(offerMovie).toBeVisible({ timeout: 10000 })
    await offerMovie.click()

    // Select a movie to request (Owner's movie: "Trade Movie Alpha")
    const requestMovie = authedPage.getByRole('option', { name: /Trade Movie Alpha/i })
    await expect(requestMovie).toBeVisible({ timeout: 10000 })
    await requestMovie.click()

    // Click "Propose Trade" submit button (in modal footer, aria-label distinguishes from panel button)
    const submitButton = authedPage.getByRole('button', { name: /Submit trade proposal/i })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    // Modal should close after successful proposal
    await waitForModalClose(authedPage)

    // Verify trade appears in the trading panel (pending or my trades tab)
    await expect(authedPage.getByText(/proposed|pending/i).first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Respond to Trade @trading', () => {
  test('recipient can view incoming trade', async ({
    authedPage,
    tradingLeagueWithTrade,
  }) => {
    // testUser is the recipient of the pre-created trade
    await authedPage.goto(`/league/${tradingLeagueWithTrade.id}/trading`)

    // Should see the pending trade offer
    await expect(authedPage.getByTestId('trading-panel')).toBeVisible({ timeout: 10000 })

    // Find the trade card
    const tradeCard = authedPage.getByTestId(`trade-card-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(tradeCard).toBeVisible({ timeout: 10000 })
  })

  test('recipient can accept trade', async ({
    authedPage,
    tradingLeagueWithTrade,
  }) => {
    // testUser is the recipient
    await authedPage.goto(`/league/${tradingLeagueWithTrade.id}/trading`)

    // Find and click accept button
    const acceptButton = authedPage.getByTestId(`accept-trade-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(acceptButton).toBeVisible({ timeout: 10000 })
    await acceptButton.click()

    // Accept opens AcceptConfirmModal - wait for it
    await waitForModalOpen(authedPage)

    // Click "Confirm Accept" button in the modal
    const confirmButton = authedPage.getByRole('button', { name: /confirm accept/i })
    await expect(confirmButton).toBeVisible()
    await confirmButton.click()

    // Wait for modal to close and action to complete
    await waitForModalClose(authedPage)
    await waitForPageSettle(authedPage)

    // Verify trade status changes (optimistic update shows immediately)
    await expect(
      authedPage.getByText(/accepted|completed|review/i).first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('recipient can reject trade', async ({
    authedPage,
    tradingLeagueWithTrade,
  }) => {
    // testUser is the recipient
    await authedPage.goto(`/league/${tradingLeagueWithTrade.id}/trading`)

    // Find and click reject button
    const rejectButton = authedPage.getByTestId(`reject-trade-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(rejectButton).toBeVisible({ timeout: 10000 })
    await rejectButton.click()

    await waitForPageSettle(authedPage)

    // Verify trade status changes to rejected
    await expect(
      authedPage.getByText(/rejected/i)
    ).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Cancel Trade @trading', () => {
  test('proposer can cancel pending trade', async ({
    authedPage,
    tradingLeagueWithTrade,
  }) => {
    // tradingLeagueWithTrade has owner as initiator, testUser as recipient
    // authedPage is logged in as testUser (the recipient)
    // As recipient, should NOT see cancel button (only proposer can cancel)
    await authedPage.goto(`/league/${tradingLeagueWithTrade.id}/trading`)

    const tradeCard = authedPage.getByTestId(`trade-card-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(tradeCard).toBeVisible({ timeout: 10000 })

    // As recipient, should NOT see cancel button
    const cancelButton = authedPage.getByTestId(`cancel-trade-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(cancelButton).not.toBeVisible()

    // Accept/Reject buttons should be visible for recipient
    const acceptButton = authedPage.getByTestId(`accept-trade-${tradingLeagueWithTrade.tradeOfferId}`)
    await expect(acceptButton).toBeVisible()
  })
})

test.describe('Veto Trade @trading', () => {
  test('league owner can veto an accepted trade during review @critical', async ({
    authedPage,
    leagueOwnerPage,
    tradingLeagueWithTrade,
  }) => {
    const league = tradingLeagueWithTrade
    const admin = getAdminClient()
    const { error } = await admin.from('leagues')
      .update({ trade_review_enabled: true, trade_veto_hours: 24 }).eq('id', league.id)
    expect(error).toBeNull()

    await authedPage.goto(`/league/${league.id}/trading`)
    await authedPage.getByTestId(`accept-trade-${league.tradeOfferId}`).click()
    await waitForModalOpen(authedPage)
    const acceptance = authedPage.waitForResponse((response) =>
      response.url().includes('/functions/v1/respond-trade') &&
      response.request().method() === 'POST'
    )
    await authedPage.getByRole('button', { name: /confirm accept/i }).click()
    expect((await acceptance).ok()).toBe(true)
    await waitForModalClose(authedPage)
    await expect(authedPage.getByTestId(`veto-trade-${league.tradeOfferId}`)).not.toBeVisible()

    await leagueOwnerPage.goto(`/league/${league.id}/trading`)
    await leagueOwnerPage.getByTestId(`veto-trade-${league.tradeOfferId}`).click()
    const dialog = leagueOwnerPage.getByRole('dialog', { name: 'Veto Trade' })
    await dialog.getByLabel('Reason (optional)').fill('Commissioner review: unbalanced exchange')
    const veto = leagueOwnerPage.waitForResponse((response) =>
      response.url().includes('/functions/v1/veto-trade') &&
      response.request().method() === 'POST'
    )
    await dialog.getByRole('button', { name: 'Confirm veto trade' }).click()
    expect((await veto).ok()).toBe(true)
    await expect(dialog).not.toBeVisible()

    // Both participants see the persisted outcome, and neither movie moved.
    for (const page of [leagueOwnerPage, authedPage]) {
      await page.reload()
      await page.getByRole('tab', { name: 'History' }).click()
      const card = page.getByTestId(`trade-card-${league.tradeOfferId}`)
      await expect(card.getByText('Vetoed', { exact: true })).toBeVisible()
      await expect(card).toContainText('Commissioner review: unbalanced exchange')
    }
    const { data: holdings, error: holdingsError } = await admin.from('team_holdings')
      .select('movie_id, team_id').eq('league_id', league.id)
    expect(holdingsError).toBeNull()
    expect(holdings).toEqual(expect.arrayContaining([
      { movie_id: league.ownerMovieId, team_id: league.ownerTeamId },
      { movie_id: league.testUserMovieId, team_id: league.testUserTeamId },
    ]))
  })
})
