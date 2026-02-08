import { test, expect } from '../../fixtures/league.fixture'
import { waitForModalOpen, waitForModalClose, waitForToast } from '../../helpers/ui.helper'

/**
 * Team Settings E2E Tests
 *
 * Tests editing team name and avatar from the league dashboard.
 * Uses activeLeague fixture which provides an active league with
 * testUser as a participant with team "Test Team".
 *
 * Key UI elements:
 * - edit-team-button: Pencil icon on TeamHeader
 * - edit-team-modal: Modal overlay (role="dialog")
 * - team-name-input: Text input for team name
 * - team-name-char-count: Character counter
 * - save-team-button: Save button
 * - cancel-edit-team: X close button
 * - team-avatar-upload: Hidden file input
 * - team-avatar-preview: Avatar image/fallback
 * - team-avatar-remove: Remove avatar button
 */

test.describe('Edit Team Modal @team', () => {
  test('pencil icon opens modal with pre-filled name @critical', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    // Wait for team header to load
    const editButton = authedPage.getByTestId('edit-team-button')
    await expect(editButton).toBeVisible({ timeout: 10000 })

    // Click pencil icon
    await editButton.click()
    await waitForModalOpen(authedPage)

    // Verify modal has pre-filled name
    const nameInput = authedPage.getByTestId('team-name-input')
    await expect(nameInput).toHaveValue('Test Team')
  })

  test('cancel closes modal without changes', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    // Click cancel (X button)
    await authedPage.getByTestId('cancel-edit-team').click()
    await waitForModalClose(authedPage)

    // Team name should be unchanged
    await expect(authedPage.getByTestId('team-name')).toHaveText('Test Team')
  })

  test('escape closes modal', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    await authedPage.keyboard.press('Escape')
    await waitForModalClose(authedPage)
  })

  test('click outside closes modal', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    // Click the overlay (top-left corner, outside the card)
    const overlay = authedPage.getByTestId('edit-team-modal')
    const box = await overlay.boundingBox()
    if (box) {
      await authedPage.mouse.click(box.x + 10, box.y + 10)
    }

    await waitForModalClose(authedPage)
  })
})

test.describe('Update Team Name @team', () => {
  test('update team name shows on dashboard @critical', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    // Clear and type new name
    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('Cinema Champions')

    await authedPage.getByTestId('save-team-button').click()
    await waitForModalClose(authedPage)

    // Verify name updated on dashboard
    await expect(authedPage.getByTestId('team-name')).toHaveText('Cinema Champions', { timeout: 10000 })
  })

  test('name persists on reload @critical', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('Persistent Studios')

    await authedPage.getByTestId('save-team-button').click()
    await waitForModalClose(authedPage)
    await expect(authedPage.getByTestId('team-name')).toHaveText('Persistent Studios', { timeout: 10000 })

    // Reload and verify
    await authedPage.reload()
    await expect(authedPage.getByTestId('team-name')).toHaveText('Persistent Studios', { timeout: 10000 })
  })

  test('updated name appears on standings @critical', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('Standings Stars')

    await authedPage.getByTestId('save-team-button').click()
    await waitForModalClose(authedPage)

    // Navigate to standings
    await authedPage.goto(`/league/${activeLeague.id}/standings`)
    await expect(authedPage.getByText('Standings Stars')).toBeVisible({ timeout: 10000 })
  })

  test('updated name appears on roster @critical', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('Roster Rebels')

    await authedPage.getByTestId('save-team-button').click()
    await waitForModalClose(authedPage)

    // Navigate to roster
    await authedPage.goto(`/league/${activeLeague.id}/roster`)
    await expect(authedPage.getByTestId('roster-team-name')).toContainText('Roster Rebels', { timeout: 10000 })
  })

  test('trimmed on save', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('  Trimmed Name  ')

    await authedPage.getByTestId('save-team-button').click()
    await waitForModalClose(authedPage)

    // Should display trimmed
    await expect(authedPage.getByTestId('team-name')).toHaveText('Trimmed Name', { timeout: 10000 })
  })
})

test.describe('Team Name Validation @team', () => {
  test('empty name disables save', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()

    // Save should be disabled
    await expect(authedPage.getByTestId('save-team-button')).toBeDisabled()
  })

  test('whitespace-only name disables save', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()
    await nameInput.fill('   ')

    // Save should be disabled (trimmed length is 0)
    await expect(authedPage.getByTestId('save-team-button')).toBeDisabled()
  })

  test('character counter turns red at limit', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    const nameInput = authedPage.getByTestId('team-name-input')
    await nameInput.clear()

    // Type 101 characters (over the 100 char limit)
    const longName = 'A'.repeat(101)
    await nameInput.fill(longName)

    // Character counter should show error styling
    const charCount = authedPage.getByTestId('team-name-char-count')
    await expect(charCount).toHaveClass(/text-error/)

    // Save should be disabled
    await expect(authedPage.getByTestId('save-team-button')).toBeDisabled()
  })
})

test.describe('Team Avatar @team', () => {
  test('upload avatar shows preview', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    // Minimal valid 1x1 red PNG
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    )

    await authedPage.getByTestId('team-avatar-upload').setInputFiles({
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    })

    // Wait for upload to complete
    await waitForToast(authedPage, /avatar updated/i)

    // Avatar preview should now show an image (not just the initial letter fallback)
    const preview = authedPage.getByTestId('team-avatar-preview')
    await expect(preview.locator('img')).toBeVisible({ timeout: 5000 })
  })

  test('remove avatar shows fallback', async ({
    authedPage,
    activeLeague,
  }) => {
    await authedPage.goto(`/league/${activeLeague.id}/dashboard`)

    await authedPage.getByTestId('edit-team-button').click()
    await waitForModalOpen(authedPage)

    // First upload an avatar
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    )

    await authedPage.getByTestId('team-avatar-upload').setInputFiles({
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    })

    await waitForToast(authedPage, /avatar updated/i)

    // Now remove it
    const removeButton = authedPage.getByTestId('team-avatar-remove')
    await expect(removeButton).toBeVisible()
    await removeButton.click()

    await waitForToast(authedPage, /avatar removed/i)

    // The img should no longer be visible in the preview (back to initial letter)
    const preview = authedPage.getByTestId('team-avatar-preview')
    await expect(preview.locator('img')).not.toBeVisible({ timeout: 5000 })
  })
})
