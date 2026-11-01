import { expect, test, type Browser, type Page } from '@playwright/test';

async function host(browser: Browser, name = 'Ada') {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create a private room' }).click();
  const code = (await page.getByTestId('room-code').innerText()).replace(/\s/g, '');
  return { page, code, context };
}

async function guest(browser: Browser, code: string, name = 'Bo') {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
  return { page, context };
}

const picker = (p: Page) => p.getByRole('group', { name: 'Choose a word' }).getByRole('button');

test.describe('word choices setting', () => {
  test('defaults to 3 and the host can raise it to 5', async ({ browser }) => {
    const h = await host(browser);
    const slider = h.page.getByRole('slider', { name: 'Word choices' });
    await expect(slider).toHaveValue('3');
    await expect(slider).toHaveAttribute('min', '2');
    await expect(slider).toHaveAttribute('max', '5');
    const g = await guest(browser, h.code);
    // Guests see the value but cannot change it.
    await expect(g.page.getByRole('slider', { name: 'Word choices' })).toBeDisabled();

    await slider.fill('5');
    await expect(g.page.getByRole('slider', { name: 'Word choices' })).toHaveValue('5');
    await h.page.getByRole('button', { name: 'Start game' }).click();
    await expect(picker(h.page)).toHaveCount(5);
    await h.context.close();
    await g.context.close();
  });

  test('can be lowered to 2', async ({ browser }) => {
    const h = await host(browser);
    const g = await guest(browser, h.code);
    await h.page.getByRole('slider', { name: 'Word choices' }).fill('2');
    await h.page.getByRole('button', { name: 'Start game' }).click();
    await expect(picker(h.page)).toHaveCount(2);
    await h.context.close();
    await g.context.close();
  });
});

test.describe('dark mode', () => {
  test('toggle on the home page switches the palette and is remembered', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto('/');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await bg();
    expect(dark).not.toBe(light);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg()).toBe(dark);

    await page.getByRole('switch', { name: 'Dark mode' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg()).toBe(light);
    await context.close();
  });

  test('starts from the system setting until a choice is made', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await context.close();
  });
});

test.describe('room code', () => {
  test('is shown read-only in the lobby and the game, but the join field still types', async ({
    browser,
  }) => {
    const h = await host(browser);
    // Lobby: tiles are plain text, the invite link box is read-only, and no input holds the code.
    await expect(h.page.getByTestId('room-code').locator('input')).toHaveCount(0);
    await expect(h.page.getByLabel('Invite link')).toHaveAttribute('readonly', '');
    const g = await guest(browser, h.code);
    await h.page.getByRole('button', { name: 'Start game' }).click();
    // Game: the code chip is not an input either.
    await expect(h.page.locator('.studio-bar .chip')).toHaveText(h.code);
    await expect(h.page.locator('.studio-bar input')).toHaveCount(0);
    await h.context.close();
    await g.context.close();

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    const field = page.getByLabel('Room code');
    await field.fill('k7m2q');
    await expect(field).toHaveValue('K7M2Q');
    await context.close();
  });
});

test.describe('reactions and canvas on laptop screens', () => {
  const sizes = [
    { width: 1280, height: 720, min: 730 },
    { width: 1366, height: 768, min: 800 },
    { width: 1440, height: 900, min: 870 },
    { width: 1536, height: 864, min: 800 },
    { width: 1920, height: 1080, min: 1200 },
  ];

  test('floating reactions stay out of the drawing, and the sheet fits without scrolling', async ({
    browser,
  }) => {
    const h = await host(browser);
    const g = await guest(browser, h.code);
    await h.page.getByRole('button', { name: 'Start game' }).click();
    await picker(h.page).first().click();
    await expect(h.page.getByTestId('secret-word')).toBeVisible();

    for (const { width, height, min } of sizes) {
      for (const p of [h.page, g.page]) {
        await p.setViewportSize({ width, height });
        const canvas = p.getByTestId('drawing-canvas');
        await expect(canvas).toBeVisible();
        const box = (await canvas.boundingBox())!;
        expect(box.width, `${width}x${height} canvas width`).toBeGreaterThanOrEqual(min);
        const overflow = await p.evaluate(() => ({
          x: document.documentElement.scrollWidth > innerWidth,
          y: document.documentElement.scrollHeight > innerHeight,
        }));
        expect(overflow, `${width}x${height} page scroll`).toEqual({ x: false, y: false });
      }
    }

    // A reaction from the guest floats up for the host without ever crossing the canvas.
    await h.page.setViewportSize({ width: 1366, height: 768 });
    await g.page.getByRole('button', { name: 'Fire' }).click();
    const float = h.page.getByTestId('emote-float').first();
    await expect(float).toBeVisible();
    const canvasBox = (await h.page.getByTestId('drawing-canvas').boundingBox())!;
    // The reactions live in the chat panel, which sits beside the sheet.
    const panel = (await h.page.getByRole('region', { name: 'Chat' }).boundingBox())!;
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(panel.x);
    for (let i = 0; i < 6; i++) {
      const f = await float.boundingBox().catch(() => null);
      if (f) {
        expect(f.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width);
        expect(f.x).toBeGreaterThanOrEqual(panel.x - 1);
      }
      await h.page.waitForTimeout(150);
    }
    await h.context.close();
    await g.context.close();
  });
});
