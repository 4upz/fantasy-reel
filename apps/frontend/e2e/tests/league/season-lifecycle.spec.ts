import { test, expect } from '../../fixtures/league.fixture'
import { getAdminClient, deleteTestLeague } from '../../helpers/supabase.helper'

test.describe('Season lifecycle', () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`ends a season and starts a clean next season at ${viewport.width}px`, async ({ leagueOwnerPage: page, activeLeague }) => {
      await page.setViewportSize(viewport)
      const admin = getAdminClient()
      const { data: current, error } = await admin.from('leagues')
        .select('season_year, series_id').eq('id', activeLeague.id).single()
      expect(error).toBeNull()
      let nextSeasonId: string | undefined
      try {
        await page.goto(`/league/${activeLeague.id}/settings`)
        await page.getByTestId('end-season-button').click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toContainText('Owner Team')
        await expect(dialog.getByTestId('confirm-end-season')).toBeDisabled()
        await dialog.locator('#confirm_season_year').fill(String(current!.season_year))
        await expect(dialog.getByTestId('confirm-end-season')).toBeEnabled()
        await dialog.getByTestId('confirm-end-season').click()
        await expect(dialog).not.toBeVisible()
        await expect(page.getByTestId('end-season-button')).toHaveCount(0)

        const { data: completed } = await admin.from('leagues')
          .select('status, final_standings, winner_team_ids').eq('id', activeLeague.id).single()
        expect(completed!.status).toBe('completed')
        expect(completed!.final_standings).toHaveLength(2)
        expect(completed!.winner_team_ids).toHaveLength(2)

        await page.getByTestId('start-next-season').click()
        await page.getByTestId('confirm-start-season').click()
        await page.waitForURL(/\/league\/(?!.*undefined)[^/]+\/settings/)
        await expect(page).not.toHaveURL(new RegExp(activeLeague.id))
        nextSeasonId = new URL(page.url()).pathname.split('/')[2]
        const { data: next } = await admin.from('leagues').select('status, season_year, series_id, final_standings, winner_team_ids')
          .eq('id', nextSeasonId).single()
        expect(next).toMatchObject({
          status: 'setup', season_year: current!.season_year + 1,
          series_id: current!.series_id, final_standings: null, winner_team_ids: null,
        })
        const { data: holdings } = await admin.from('team_holdings').select('holding_id').eq('league_id', nextSeasonId)
        expect(holdings).toEqual([])
        await page.goto(`/league/${nextSeasonId}/history`)
        await expect(page.getByRole('main')).toContainText(String(current!.season_year))
        await expect(page.getByRole('main')).toContainText(String(current!.season_year + 1))
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width)
      } finally {
        if (nextSeasonId) await deleteTestLeague(nextSeasonId)
      }
    })
  }

  test('does not allow completion when the standings preview fails', async ({ leagueOwnerPage: page, activeLeague }) => {
    const admin = getAdminClient()
    const { data: current } = await admin.from('leagues').select('season_year').eq('id', activeLeague.id).single()
    await page.goto(`/league/${activeLeague.id}/settings`)
    await page.route('**/rest/v1/rpc/league_standings', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Standings unavailable' }),
    }))
    await page.getByTestId('end-season-button').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('alert')).toBeVisible()
    await dialog.locator('#confirm_season_year').fill(String(current!.season_year))
    await expect(dialog.getByTestId('confirm-end-season')).toBeDisabled()
    const { data: league } = await admin.from('leagues').select('status').eq('id', activeLeague.id).single()
    expect(league!.status).toBe('active')
  })
})
