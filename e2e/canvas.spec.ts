import { expect, test, type Browser, type Page } from '@playwright/test';

async function newPlayer(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page };
}

async function createRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create a private room' }).click();
  const tiles = page.getByTestId('room-code');
  await expect(tiles).toBeVisible();
  return (await tiles.innerText()).replace(/\s/g, '');
}

async function joinRoom(page: Page, code: string, name: string) {
  await page.goto(`/r/${code}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

/** The drawer takes the first word on offer, which starts the clock. */
async function pickWord(page: Page) {
  await page.getByRole('group', { name: 'Choose a word' }).getByRole('button').first().click();
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
}

/** A host and a friend, both on the drawing board. */
async function startedRoom(browser: Browser) {
  const host = await newPlayer(browser);
  const code = await createRoom(host.page, 'Ada');
  const guest = await newPlayer(browser);
  await joinRoom(guest.page, code, 'Bo');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  for (const { page } of [host, guest]) {
    await expect(page.getByTestId('drawing-canvas')).toBeVisible();
  }
  await pickWord(host.page);
  return { host, guest, code };
}

const canvas = (page: Page) => page.getByTestId('drawing-canvas');

/** Drag across the canvas between two points given as fractions of its size. */
async function drag(page: Page, from: [number, number], to: [number, number], steps = 12) {
  const box = (await canvas(page).boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps });
  await page.mouse.up();
}

/** RGB of the canvas at a fractional position. */
const pixel = (page: Page, x: number, y: number) =>
  canvas(page).evaluate(
    (el, [fx, fy]) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(fx! * c.width, fy! * c.height, 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [x, y],
  );

const image = (page: Page) => canvas(page).evaluate((el) => (el as HTMLCanvasElement).toDataURL());

const INK = [0, 0, 0];
const WHITE = [255, 255, 255];

/** Retry until both canvases hold the same pixels. */
const expectSame = (a: Page, b: Page) =>
  expect.poll(async () => (await image(a)) === (await image(b))).toBe(true);

test('start needs two players and only the host can press it', async ({ browser }) => {
  const host = await newPlayer(browser);
  const code = await createRoom(host.page, 'Ada');
  const start = host.page.getByRole('button', { name: 'Start game' });
  await expect(start).toBeDisabled();

  const guest = await newPlayer(browser);
  await joinRoom(guest.page, code, 'Bo');
  await expect(start).toBeEnabled();
  await expect(guest.page.getByRole('button', { name: 'Start game' })).toBeDisabled();

  await start.click();
  await expect(canvas(guest.page)).toBeVisible();
  await pickWord(host.page);
  await expect(guest.page.getByRole('toolbar')).toHaveCount(0);
  await expect(guest.page.getByRole('status')).toContainText('Ada is drawing');
  await Promise.all([host, guest].map((p) => p.context.close()));
});

test('a stroke appears for the other player, and viewers cannot draw', async ({ browser }) => {
  const { host, guest } = await startedRoom(browser);
  await expect.poll(() => pixel(guest.page, 0.5, 0.5)).toEqual(WHITE);

  await drag(host.page, [0.2, 0.5], [0.8, 0.5]);
  await expect.poll(() => pixel(guest.page, 0.5, 0.5)).toEqual(INK);
  await expect.poll(() => pixel(host.page, 0.5, 0.5)).toEqual(INK);
  await expectSame(host.page, guest.page);

  // The viewer's mouse does nothing, locally or for the host.
  await drag(guest.page, [0.5, 0.1], [0.5, 0.9]);
  await host.page.waitForTimeout(300);
  expect(await pixel(guest.page, 0.5, 0.2)).toEqual(WHITE);
  expect(await pixel(host.page, 0.5, 0.2)).toEqual(WHITE);
  await Promise.all([host, guest].map((p) => p.context.close()));
});

test('colours, sizes, eraser, fill, undo and clear all sync', async ({ browser }) => {
  const { host, guest } = await startedRoom(browser);
  const h = host.page;

  // Colour #ff0000, widest brush.
  await h.getByRole('button', { name: 'Colour #ff0000' }).click();
  await h.getByRole('button', { name: 'Size 5' }).click();
  await drag(h, [0.1, 0.2], [0.9, 0.2]);
  await expect.poll(() => pixel(guest.page, 0.5, 0.2)).toEqual([255, 0, 0]);
  // A 40px brush on a 960x720 sheet is ~5.5% of the height: the stroke is thick.
  expect(await pixel(guest.page, 0.5, 0.2 + 0.02)).toEqual([255, 0, 0]);

  // Draw a closed box in thin ink, then flood-fill its inside.
  await h.getByRole('button', { name: 'Colour #000000' }).click();
  await h.getByRole('button', { name: 'Size 2' }).click();
  await drag(h, [0.3, 0.5], [0.7, 0.5]);
  await drag(h, [0.7, 0.5], [0.7, 0.9]);
  await drag(h, [0.7, 0.9], [0.3, 0.9]);
  await drag(h, [0.3, 0.9], [0.3, 0.5]);
  await h.getByRole('button', { name: 'Colour #00ffff' }).click();
  await h.getByRole('button', { name: 'Fill' }).click();
  const box = (await canvas(h).boundingBox())!;
  await canvas(h).click({ position: { x: box.width * 0.5, y: box.height * 0.7 } });
  const inside = () => pixel(guest.page, 0.5, 0.7);
  await expect.poll(inside).toEqual([0, 255, 255]);
  expect(await pixel(guest.page, 0.05, 0.7)).toEqual(WHITE);
  await expectSame(h, guest.page);

  // Eraser cuts through the fill; undo twice takes the fill and the cut back.
  const filled = await image(h);
  await h.getByRole('button', { name: 'Eraser' }).click();
  await h.getByRole('button', { name: 'Size 5' }).click();
  await drag(h, [0.4, 0.7], [0.6, 0.7]);
  await expect.poll(inside).toEqual(WHITE);
  await h.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => image(guest.page)).toBe(filled);
  await h.keyboard.press('Control+z');
  await expect.poll(inside).toEqual(WHITE);
  await expectSame(h, guest.page);

  // Clear wipes both sheets.
  await h.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(() => pixel(guest.page, 0.5, 0.2)).toEqual(WHITE);
  expect(await pixel(h, 0.5, 0.2)).toEqual(WHITE);
  await expect(h.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await Promise.all([host, guest].map((p) => p.context.close()));
});

test('late joiners and refreshes get the whole drawing back', async ({ browser }) => {
  const { host, guest, code } = await startedRoom(browser);
  await host.page.getByRole('button', { name: 'Colour #0000ff' }).click();
  await drag(host.page, [0.1, 0.1], [0.9, 0.9], 30);
  await host.page.getByRole('button', { name: 'Colour #ffa500' }).click();
  await drag(host.page, [0.1, 0.9], [0.9, 0.1], 30);
  await expectSame(host.page, guest.page);
  const final = await image(host.page);

  // A viewer refreshes and reclaims the same seat with the picture intact.
  await guest.page.reload();
  await expect(canvas(guest.page)).toBeVisible();
  await expect.poll(() => image(guest.page)).toBe(final);

  // So does the drawer, and can keep drawing afterwards.
  await host.page.reload();
  await expect(host.page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
  await expect.poll(() => image(host.page)).toBe(final);
  await drag(host.page, [0.5, 0.05], [0.5, 0.15]);
  await expectSame(host.page, guest.page);

  // A brand-new player joining mid-drawing lands straight on the board.
  const late = await newPlayer(browser);
  await joinRoom(late.page, code, 'Cy');
  await expect(canvas(late.page)).toBeVisible();
  await expectSame(host.page, late.page);
  await Promise.all([host, guest, late].map((p) => p.context.close()));
});

test('back to lobby wipes the board for the next round', async ({ browser }) => {
  const { host, guest } = await startedRoom(browser);
  await drag(host.page, [0.2, 0.5], [0.8, 0.5]);
  await expect.poll(() => pixel(guest.page, 0.5, 0.5)).toEqual(INK);

  await expect(guest.page.getByRole('button', { name: 'Back to lobby' })).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Back to lobby' }).click();
  await expect(guest.page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(canvas(guest.page)).toBeVisible();
  await pickWord(host.page);
  await expect.poll(() => pixel(guest.page, 0.5, 0.5)).toEqual(WHITE);
  await Promise.all([host, guest].map((p) => p.context.close()));
});

test('the studio fits a phone-sized screen', async ({ browser }) => {
  const host = await newPlayer(browser);
  const code = await createRoom(host.page, 'Ada');
  const phone = await browser.newContext({
    viewport: { width: 375, height: 760 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await phone.newPage();
  await joinRoom(page, code, 'Bo');
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(canvas(page)).toBeVisible();
  await pickWord(host.page);
  // Empty when the page fits; otherwise names the elements past the right edge.
  const overflow = () =>
    page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
        ? []
        : [...document.querySelectorAll('body *')]
            .filter(
              (el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
            )
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().right)}px`,
            )
            .slice(0, 8),
    );
  await expect.poll(overflow).toEqual([]);
  // The drawer's toolbar fits the narrow screen too.
  await expect(host.page.getByRole('toolbar')).toBeVisible();
  await Promise.all([host.context.close(), phone.close()]);
});

test('the palette uses the pure standard colours', async ({ browser }) => {
  const { host, guest } = await startedRoom(browser);
  const names = await host.page
    .getByRole('group', { name: 'Colour' })
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ffffff', '#000000', '#008000']) {
    expect(names).toContain(`Colour ${hex}`);
  }
  await Promise.all([host, guest].map((p) => p.context.close()));
});

test('shape tools sync live, undo, and survive a late join', async ({ browser }) => {
  const { host, guest, code } = await startedRoom(browser);
  const h = host.page;
  await h.getByRole('button', { name: 'Colour #ff0000' }).click();

  // Solid rectangle.
  await h.getByRole('button', { name: 'Rectangle' }).click();
  await h.getByRole('button', { name: 'Solid' }).click();
  await drag(h, [0.1, 0.1], [0.4, 0.4]);
  await expect.poll(() => pixel(guest.page, 0.25, 0.25)).toEqual([255, 0, 0]);

  // Outline ellipse: edge is inked, centre stays blank.
  await h.getByRole('button', { name: 'Solid' }).click();
  await h.getByRole('button', { name: 'Colour #0000ff' }).click();
  await h.getByRole('button', { name: 'Ellipse' }).click();
  await drag(h, [0.5, 0.1], [0.9, 0.5]);
  await expect.poll(() => pixel(guest.page, 0.9, 0.3)).toEqual([0, 0, 255]);
  expect(await pixel(guest.page, 0.7, 0.3)).toEqual(WHITE);

  // Line.
  await h.getByRole('button', { name: 'Colour #000000' }).click();
  await h.getByRole('button', { name: 'Line' }).click();
  await drag(h, [0.1, 0.8], [0.9, 0.8]);
  await expect.poll(() => pixel(guest.page, 0.5, 0.8)).toEqual(INK);
  await expectSame(h, guest.page);

  // A shape is one undo step, and a late joiner gets the remaining shapes.
  await h.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => pixel(guest.page, 0.5, 0.8)).toEqual(WHITE);
  const late = await newPlayer(browser);
  await joinRoom(late.page, code, 'Cy');
  await expect.poll(() => pixel(late.page, 0.25, 0.25)).toEqual([255, 0, 0]);
  await expectSame(h, late.page);
  await Promise.all([host, guest, late].map((p) => p.context.close()));
});

test.describe('canvas scales with the window', () => {
  const sizes = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'laptop', width: 1366, height: 768 },
    { name: 'desktop', width: 1920, height: 1080 },
    { name: 'large desktop', width: 2560, height: 1440 },
  ];
  const widths: Record<string, number> = {};

  for (const size of sizes) {
    test(`${size.name}: fits the window, keeps 4:3 and the logical size`, async ({ browser }) => {
      const host = await newPlayer(browser, size);
      const code = await createRoom(host.page, 'Ada');
      const guest = await newPlayer(browser);
      await joinRoom(guest.page, code, 'Bo');
      await host.page.getByRole('button', { name: 'Start game' }).click();
      const canvas = host.page.getByTestId('drawing-canvas');
      await expect(canvas).toBeVisible();

      const box = (await canvas.boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(4 / 3, 1);
      expect(box.width).toBeLessThanOrEqual(size.width);
      // Never wider than the window, and no sideways scroll.
      const overflow = await host.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      // The drawing space stays fixed, whatever the display size.
      const backing = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
      expect(backing).toEqual([960, 720]);
      widths[size.name] = box.width;
      await host.context.close();
      await guest.context.close();
    });
  }

  test('larger windows get a larger sheet', () => {
    expect(widths['laptop']).toBeGreaterThan(widths['phone']!);
    expect(widths['desktop']).toBeGreaterThan(widths['laptop']!);
    expect(widths['large desktop']).toBeGreaterThan(widths['desktop']!);
  });
});
