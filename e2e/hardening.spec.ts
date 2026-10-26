import { expect, test, type Browser, type Page } from '@playwright/test';

async function open(browser: Browser, name: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(
    viewport ? { viewport, isMobile: true, hasTouch: true } : undefined,
  );
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  return { name, page, context, problems };
}
type Player = Awaited<ReturnType<typeof open>>;

async function create(p: Player) {
  await p.page.goto('/');
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: 'Create a private room' }).click();
  const tiles = p.page.getByTestId('room-code');
  await expect(tiles).toBeVisible();
  return (await tiles.innerText()).replace(/\s/g, '');
}

async function join(p: Player, code: string) {
  await p.page.goto(`/r/${code}`);
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(p.page.getByRole('listitem').filter({ hasText: p.name })).toBeVisible();
}

/** Starts the game and has the host pick a word, so the host draws and the guest guesses. */
async function startAndDraw(host: Page) {
  await host.getByRole('button', { name: 'Start game' }).click();
  await host.getByRole('group', { name: 'Choose a word' }).getByRole('button').first().click();
  await expect(host.getByTestId('secret-word')).toBeVisible();
}

test.describe('phone layout', () => {
  test('the chat box is on screen and the drawing stays visible while typing', async ({
    browser,
  }) => {
    const host = await open(browser, 'Hosty', { width: 390, height: 844 });
    const guest = await open(browser, 'Guesty', { width: 390, height: 844 });
    const code = await create(host);
    await join(guest, code);
    await startAndDraw(host.page);

    const input = guest.page.getByLabel('Guess or chat');
    const sheet = guest.page.locator('.sheet');
    await expect(input).toBeVisible();

    // Without the keyboard: input is within the first screen, no scrolling needed.
    let box = (await input.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    // Typing on iOS zooms the page unless the text is at least 16px.
    expect(
      await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);

    // Keyboard up: the visible height collapses; sheet and input must both still fit.
    await guest.page.setViewportSize({ width: 390, height: 500 });
    await input.focus();
    await guest.page.waitForTimeout(200);
    const s = (await sheet.boundingBox())!;
    box = (await input.boundingBox())!;
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.y + s.height).toBeLessThanOrEqual(box.y + 4);
    expect(box.y + box.height).toBeLessThanOrEqual(500);

    // And it still works: a guess goes through from the phone.
    await input.fill('hello there');
    await input.press('Enter');
    await expect(host.page.getByTestId('chat-log')).toContainText('hello there');

    await guest.page.screenshot({ path: 'test-results/phone-keyboard.png' });
    expect(guest.problems).toEqual([]);
    await host.context.close();
    await guest.context.close();
  });
});

test.describe('names and chat', () => {
  test('refuses an unfriendly name and masks bad words in chat', async ({ browser }) => {
    const host = await open(browser, 'Hosty');
    const guest = await open(browser, 'Guesty');
    await guest.page.goto('/');
    await guest.page.getByLabel('Your name').fill('f.u.c.k');
    await guest.page.getByRole('button', { name: 'Create a private room' }).click();
    await expect(guest.page.getByRole('alert')).toContainText('friendlier name');

    const code = await create(host);
    await join(guest, code);
    await guest.page.getByLabel('Guess or chat').fill('this is shit lol');
    await guest.page.getByLabel('Guess or chat').press('Enter');
    await expect(host.page.getByTestId('chat-log')).toContainText('this is **** lol');
    await expect(host.page.getByTestId('chat-log')).not.toContainText('shit');
    await host.context.close();
    await guest.context.close();
  });
});

test.describe('hosting', () => {
  test('the host role moves to a connected player as soon as the host drops', async ({
    browser,
  }) => {
    const host = await open(browser, 'Hosty');
    const guest = await open(browser, 'Guesty');
    const code = await create(host);
    await join(guest, code);
    await expect(guest.page.getByText('Only the host can change these.')).toBeVisible();

    // The host's connection dies (not a polite leave), and the guest takes over at once.
    await host.context.close();
    await expect(guest.page.getByText('Only the host can change these.')).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(guest.page.getByText('Everyone is in. Start when you are ready.')).toBeVisible();
    await guest.context.close();
  });

  test('a kicked player cannot return under a new name', async ({ browser }) => {
    const host = await open(browser, 'Hosty');
    const guest = await open(browser, 'Guesty');
    const code = await create(host);
    await join(guest, code);
    await host.page.getByRole('button', { name: 'Remove Guesty' }).click();
    await expect(guest.page.getByRole('alert')).toContainText('removed you');

    // Same machine, different name, fresh page: the address is barred too.
    await guest.page.goto(`/r/${code}`);
    await guest.page.getByLabel('Your name').fill('Somebody Else');
    await guest.page.getByRole('button', { name: `Join room ${code}` }).click();
    await expect(guest.page.getByRole('alert')).toContainText('removed you');
    await host.context.close();
    await guest.context.close();
  });
});

test.describe('server headers', () => {
  test('sends security headers, hides the framework, and caches assets for a year', async ({
    request,
  }) => {
    const page = await request.get('/', { headers: { 'accept-encoding': 'gzip' } });
    expect(page.headers()['x-powered-by']).toBeUndefined();
    expect(page.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers()['x-content-type-options']).toBe('nosniff');
    expect(page.headers()['x-frame-options']).toBe('DENY');
    expect(page.headers()['cache-control']).toBe('no-cache');

    const html = await page.text();
    const asset = html.match(/\/assets\/[^"]+\.js/)![0];
    const js = await request.get(asset, { headers: { 'accept-encoding': 'gzip' } });
    expect(js.headers()['cache-control']).toContain('max-age=31536000');
    expect(js.headers()['cache-control']).toContain('immutable');
    expect(js.headers()['content-encoding']).toBe('gzip');
  });

  test('the strict policy does not break a real game', async ({ browser }) => {
    const host = await open(browser, 'Hosty');
    const guest = await open(browser, 'Guesty');
    const code = await create(host);
    await join(guest, code);
    await startAndDraw(host.page);
    const board = host.page.locator('canvas').first();
    const box = (await board.boundingBox())!;
    await host.page.mouse.move(box.x + 40, box.y + 40);
    await host.page.mouse.down();
    await host.page.mouse.move(box.x + 160, box.y + 120, { steps: 8 });
    await host.page.mouse.up();
    await expect(guest.page.getByTestId('hint')).toBeVisible();
    expect(host.problems).toEqual([]);
    expect(guest.problems).toEqual([]);
    await host.context.close();
    await guest.context.close();
  });
});
