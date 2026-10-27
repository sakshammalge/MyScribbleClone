import { expect, test, type Browser, type Page } from '@playwright/test';

async function player(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext(opts);
  return { context, page: await context.newPage() };
}

async function enter(page: Page, name: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Your name').fill(name);
  await page
    .getByRole('button', { name: code ? `Join room ${code}` : 'Create a private room' })
    .click();
  if (code) return code;
  const tiles = page.getByTestId('room-code');
  await expect(tiles).toBeVisible();
  return (await tiles.innerText()).replace(/\s/g, '');
}

async function scribble(page: Page) {
  const box = (await page.getByTestId('drawing-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();
}

/** Two players play four turns; each drawer scribbles and the other guesses. Returns the words. */
async function playGame(ada: Page, bo: Page) {
  await ada.getByRole('slider', { name: 'Rounds' }).fill('2');
  await ada.getByRole('button', { name: 'Start game' }).click();
  const words: string[] = [];
  for (const [drawer, guesser] of [
    [ada, bo],
    [bo, ada],
    [ada, bo],
    [bo, ada],
  ] as const) {
    const choices = drawer.getByRole('group', { name: 'Choose a word' }).getByRole('button');
    await expect(choices).toHaveCount(3);
    const word = (await choices.first().innerText()).trim();
    await choices.first().click();
    await expect(drawer.getByTestId('secret-word')).toContainText(word);
    await scribble(drawer);
    await guesser.getByLabel('Guess or chat').fill(word);
    await guesser.getByRole('button', { name: 'Send' }).click();
    await expect(guesser.getByTestId('reveal')).toContainText(word);
    words.push(word);
  }
  await expect(ada.getByTestId('standings')).toBeVisible();
  return words;
}

test('the gallery shows every drawing, saves PNGs named after the word, and resets on rematch', async ({
  browser,
}) => {
  const a = await player(browser);
  const b = await player(browser, { viewport: { width: 375, height: 760 }, hasTouch: true });
  const code = await enter(a.page, 'Ada');
  await enter(b.page, 'Bo', code);
  const words = await playGame(a.page, b.page);

  for (const page of [a.page, b.page]) {
    const cards = page.getByTestId('gallery-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText(words[0]!);
    await expect(cards.nth(0)).toContainText('drawn by Ada');
    await expect(cards.nth(1)).toContainText('drawn by Bo');
  }

  // Save the first drawing: the filename is the word and the file is a real, non-blank PNG.
  const download = a.page.waitForEvent('download');
  await a.page.getByRole('link', { name: 'Save PNG' }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(
    `inkling-${words[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
  );
  const png = await (await import('node:fs/promises')).readFile((await file.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeGreaterThan(2000);
  // The saved image is the 960x720 drawing plus the caption strip with the word and drawer.
  expect(png.readUInt32BE(16)).toBe(960);
  expect(png.readUInt32BE(20)).toBe(720 + 64);

  // The carousel scrolls by itself, and holds still while hovered.
  const track = a.page.locator('.gallery-track');
  const left = () => track.evaluate((el) => el.scrollLeft);
  await track.evaluate((el) => (el.style.maxWidth = '300px'));
  // The pointer is still over the Save link from above, which holds the carousel still.
  await a.page.mouse.move(0, 0);
  await expect.poll(left).toBeGreaterThan(0);
  await track.hover();
  const held = await left();
  await a.page.waitForTimeout(500);
  expect(await left()).toBe(held);

  // The phone has no horizontal overflow.
  await expect
    .poll(() =>
      b.page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  // A refresh (reconnect) still shows every drawing.
  await b.page.reload();
  await expect(b.page.getByTestId('gallery-card')).toHaveCount(4);

  // A player joining after the game ended sees them too.
  const c = await player(browser);
  await enter(c.page, 'Cy', code);
  await expect(c.page.getByTestId('gallery-card')).toHaveCount(4);

  await a.page.getByRole('button', { name: 'Play again' }).click();
  await expect(a.page.getByTestId('standings')).toHaveCount(0);
  await expect(a.page.getByTestId('gallery')).toHaveCount(0);
  await Promise.all([a, b, c].map((p) => p.context.close()));
});

test('with reduced motion the carousel stays put and can be scrolled by hand', async ({
  browser,
}) => {
  const a = await player(browser, { reducedMotion: 'reduce' });
  const b = await player(browser);
  const code = await enter(a.page, 'Ada');
  await enter(b.page, 'Bo', code);
  await playGame(a.page, b.page);
  const track = a.page.locator('.gallery-track');
  await expect(track).toBeVisible();
  await track.evaluate((el) => (el.style.maxWidth = '300px'));
  await a.page.waitForTimeout(800);
  expect(await track.evaluate((el) => el.scrollLeft)).toBe(0);
  await track.evaluate((el) => el.scrollTo({ left: 100 }));
  expect(await track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await a.context.close();
  await b.context.close();
});
