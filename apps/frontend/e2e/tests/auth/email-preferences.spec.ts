import { test, expect } from '../../fixtures/auth.fixture'

test.describe('Season recap email opt-out', () => {
  test('the settings toggle saves and survives a reload', async ({ authedPage: page }) => {
    await page.goto('/settings')
    const toggle = page.getByTestId('season-recap-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await page.reload()
    await expect(page.getByTestId('season-recap-toggle')).toHaveAttribute('aria-checked', 'false')

    // Leave the worker's shared user opted in for any later test.
    await page.getByTestId('season-recap-toggle').click()
    await expect(page.getByTestId('season-recap-toggle')).toHaveAttribute('aria-checked', 'true')
    await page.reload()
    await expect(page.getByTestId('season-recap-toggle')).toHaveAttribute('aria-checked', 'true')
  })

  test('the unsubscribe page is public and asks before unsubscribing', async ({ page }) => {
    await page.goto('/unsubscribe?token=00000000-0000-4000-8000-000000000000')
    await expect(page).toHaveURL(/\/unsubscribe/)
    await expect(page.getByRole('heading', { name: 'Stop season recap emails?' })).toBeVisible()

    await page.getByTestId('unsubscribe-button').click()
    await expect(page.getByText("This unsubscribe link isn't valid.")).toBeVisible()
  })

  test('the unsubscribe page explains a link without a token', async ({ page }) => {
    await page.goto('/unsubscribe')
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible()
  })
})
