import { expect, test } from '@playwright/test';

test('home page loads and connects to the server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inkling' })).toBeVisible();
  await page.getByLabel('Your name').fill('Smoke');
  await expect(page.getByRole('button', { name: 'Create a private room' })).toBeEnabled();
});

test('dark theme tokens apply when the OS prefers dark', async ({ browser }) => {
  const page = await browser.newPage({ colorScheme: 'dark' });
  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(20, 18, 43)');
  await page.close();
});
