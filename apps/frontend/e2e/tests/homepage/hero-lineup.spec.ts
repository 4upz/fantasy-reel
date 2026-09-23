import { test, expect } from '../../fixtures/auth.fixture'

const SURROUNDINGS = ['#hero-title', '[data-testid="hero-movie-lineup"] figcaption', '#how-it-works']

test.describe('Homepage hero lineup', () => {
  // One viewport where the hero centers its content, one where the content overflows it.
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    test(`selecting a poster keeps the hero still at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/')

      const positions: number[][] = []
      for (const poster of await page.getByTestId('hero-movie-lineup').getByRole('button').all()) {
        // Retried because a click before hydration is lost.
        await expect(async () => {
          await poster.click()
          await expect(poster).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
        }).toPass()
        positions.push(await page.evaluate(selectors => selectors.map(selector =>
          Math.round(document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY)
        ), SURROUNDINGS))
      }

      expect(positions).toHaveLength(4)
      for (const selected of positions) expect(selected).toEqual(positions[0])
    })
  }
})
