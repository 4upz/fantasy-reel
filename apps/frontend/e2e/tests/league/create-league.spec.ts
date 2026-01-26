import { test, expect } from '../../fixtures/auth.fixture'
import { generateLeagueName } from '../../fixtures/test-data'
import { deleteTestLeague, getAdminClient } from '../../helpers/supabase.helper'

/**
 * League creation E2E tests
 * Tests creating leagues with various configurations
 */
test.describe('Create League', () => {
  let createdLeagueId: string | null = null

  test.afterEach(async () => {
    // Clean up created league
    if (createdLeagueId) {
      await deleteTestLeague(createdLeagueId)
      createdLeagueId = null
    }
  })

  test('user can create a new league @critical', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    const leagueName = generateLeagueName()

    await page.goto('/dashboard')

    // Open create league modal
    await page.click('[data-testid="create-league-button"]')

    // Wait for modal to appear
    await expect(page.getByRole('dialog')).toBeVisible()

    // Fill league details
    await page.fill('[data-testid="league-name-input"]', leagueName)
    await page.fill('[data-testid="max-participants-input"]', '8')
    await page.selectOption('[data-testid="draft-type-select"]', 'snake')

    // Submit
    await page.click('[data-testid="create-league-submit"]')

    // Should navigate to new league page
    await page.waitForURL(/\/league\/[a-f0-9-]+/)

    // Extract league ID from URL for cleanup
    const url = page.url()
    const match = url.match(/\/league\/([a-f0-9-]+)/)
    if (match) {
      createdLeagueId = match[1]
    }

    // Should show league name
    await expect(page.getByText(leagueName)).toBeVisible()

    // Should show setup status badge
    await expect(page.getByText(/setup/i)).toBeVisible()
  })

  test('validates required fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    await page.goto('/dashboard')
    await page.click('[data-testid="create-league-button"]')

    // Wait for modal
    await expect(page.getByRole('dialog')).toBeVisible()

    // Try to submit without filling required fields
    await page.click('[data-testid="create-league-submit"]')

    // Should show validation error
    await expect(page.getByText(/league name.*required|name is required/i)).toBeVisible()
  })

  test('enforces max participants limits', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    await page.goto('/dashboard')
    await page.click('[data-testid="create-league-button"]')

    // Try to set invalid max participants
    await page.fill('[data-testid="league-name-input"]', 'Test League')
    await page.fill('[data-testid="max-participants-input"]', '1') // Too few

    await page.click('[data-testid="create-league-submit"]')

    // Should show validation error about minimum participants
    await expect(page.getByText(/at least|minimum|participants/i)).toBeVisible()
  })

  test('modal can be closed without creating', async ({ authenticatedPage }) => {
    const page = authenticatedPage

    await page.goto('/dashboard')
    await page.click('[data-testid="create-league-button"]')

    // Wait for modal
    await expect(page.getByRole('dialog')).toBeVisible()

    // Close modal (click X or cancel button)
    await page.click('[data-testid="close-modal-button"]')

    // Modal should be gone
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // Should still be on dashboard
    expect(page.url()).toContain('/dashboard')
  })
})

test.describe('League List', () => {
  test('shows created leagues on dashboard', async ({ authenticatedPage, testUser }) => {
    const page = authenticatedPage
    const leagueName = generateLeagueName()

    // Create league via API for setup
    const client = getAdminClient()
    const { data: league } = await client
      .from('leagues')
      .insert({
        name: leagueName,
        owner_id: testUser.id,
        status: 'setup',
        max_participants: 8,
      })
      .select()
      .single()

    if (league) {
      await client.from('league_participants').insert({
        league_id: league.id,
        user_id: testUser.id,
        role: 'owner',
        status: 'active',
      })
    }

    try {
      // Navigate to dashboard
      await page.goto('/dashboard')

      // Should show the league
      await expect(page.getByText(leagueName)).toBeVisible()
    } finally {
      // Cleanup
      if (league) {
        await deleteTestLeague(league.id)
      }
    }
  })

  test('shows empty state when no leagues', async ({ authenticatedPage }) => {
    // This test assumes the user has no leagues
    // The authenticatedPage fixture creates a fresh user each time
    const page = authenticatedPage

    await page.goto('/dashboard')

    // Should show empty state or call to action
    await expect(page.getByText(/no leagues|create.*first|get started/i)).toBeVisible()
  })
})
