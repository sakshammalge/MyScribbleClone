import { expect, test } from '@playwright/test';

test('page loads and connects to the server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inkling' })).toBeVisible();
  await expect(page.locator('.status')).toContainText('connected');
});

test('doodle canvas paints pixels when dragged on', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByLabel('Doodle area');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 8 });
  await page.mouse.up();
  const painted = await canvas.evaluate((el: HTMLCanvasElement) =>
    el
      .getContext('2d')!
      .getImageData(0, 0, el.width, el.height)
      .data.some((v, i) => i % 4 === 3 && v > 0),
  );
  expect(painted).toBe(true);
});

test('dark theme tokens apply when the OS prefers dark', async ({ browser }) => {
  const page = await browser.newPage({ colorScheme: 'dark' });
  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(20, 18, 43)');
  await page.close();
});
