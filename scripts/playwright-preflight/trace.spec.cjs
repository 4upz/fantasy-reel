const { test, expect } = require('@playwright/test')

test('runner finalizes a real browser trace without network access', async ({ page }) => {
  await page.route('**/*', route => route.abort())
  await page.setContent('<button>Verify runner</button><output></output>')
  await page.locator('button').evaluate(button => {
    button.addEventListener('click', () => { document.querySelector('output').textContent = 'Ready' })
  })
  await page.getByRole('button', { name: 'Verify runner' }).click()
  await expect(page.locator('output')).toHaveText('Ready')
})
