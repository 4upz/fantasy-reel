/**
 * UI interaction helpers for E2E tests
 *
 * Provides utilities for common UI patterns like modals, toasts,
 * and page state management. These helpers abstract timing concerns
 * and provide consistent waiting strategies across tests.
 */

import { Page, expect } from '@playwright/test'

/**
 * Wait for a modal dialog to open.
 *
 * Waits for the dialog role to become visible.
 * Playwright's toBeVisible already waits for stability (no layout shifts),
 * so no additional animation buffer is needed.
 *
 * @param page - Playwright Page object
 * @throws If no dialog appears within 5 seconds
 */
export async function waitForModalOpen(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
}

/**
 * Wait for a modal dialog to close.
 *
 * Waits for the dialog role to disappear from the DOM.
 *
 * @param page - Playwright Page object
 * @throws If dialog is still visible after 5 seconds
 */
export async function waitForModalClose(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })
}

/**
 * Wait for a toast notification with specific text pattern.
 *
 * Toasts may appear with delays due to async operations,
 * so this uses a longer timeout than modal helpers.
 *
 * @param page - Playwright Page object
 * @param textPattern - Regular expression to match toast content
 * @throws If matching toast doesn't appear within 10 seconds
 */
export async function waitForToast(page: Page, textPattern: RegExp): Promise<void> {
  await expect(page.getByText(textPattern)).toBeVisible({ timeout: 10000 })
}

/**
 * Wait for page to settle after an action.
 *
 * Waits for DOM content to be loaded. Callers should follow up
 * with specific element assertions rather than relying on networkidle
 * (which is unreliable with Supabase Realtime WebSockets that keep
 * connections open indefinitely).
 *
 * @param page - Playwright Page object
 */
export async function waitForPageSettle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
}
