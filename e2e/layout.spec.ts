import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * The game screen must fit the window at every size: no page scroll, the whole drawing sheet and
 * the controls on screen, and every player reachable. A full room (ten players) is the worst case,
 * so one room is reused for every viewport by resizing two pages (the drawer and a guesser).
 */

const NAMES = ['Ada', 'Bo', 'Cy', 'Dee Longername', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];

interface Viewport {
  width: number;
  height: number;
  /** The least canvas width (CSS px) that the layout must give the drawer at this size. */
  minCanvas: number;
}

const VIEWPORTS: Viewport[] = [
  { width: 1280, height: 720, minCanvas: 730 },
  { width: 1320, height: 820, minCanvas: 880 },
  { width: 1366, height: 768, minCanvas: 800 },
  { width: 1440, height: 900, minCanvas: 980 },
  { width: 1512, height: 982, minCanvas: 1090 },
  { width: 1728, height: 1000, minCanvas: 1110 },
  { width: 1920, height: 1080, minCanvas: 1200 },
  { width: 1024, height: 768, minCanvas: 670 },
  { width: 768, height: 1024, minCanvas: 700 },
  { width: 390, height: 844, minCanvas: 350 },
  { width: 844, height: 390, minCanvas: 340 },
];

const LAPTOP = { width: 1366, height: 768 };

interface Seat {
  context: BrowserContext;
  page: Page;
}

let seats: Seat[] = [];
let code = '';
/** Who is drawing the first turn and what the word is, once the drawing test has picked it. */
let turnOne: { page: Page; word: string };

const pages = () => seats.map((s) => s.page);
const host = () => seats[0]!.page;

const pickerOf = (page: Page) => page.getByRole('group', { name: 'Choose a word' });

async function seat(browser: Browser): Promise<Seat> {
  const context = await browser.newContext({ viewport: LAPTOP });
  return { context, page: await context.newPage() };
}

/** The page whose player is choosing the word right now. */
async function drawerIndex(): Promise<number> {
  let found = -1;
  await expect
    .poll(
      async () => {
        for (const [i, page] of pages().entries()) {
          if (await pickerOf(page).isVisible()) {
            found = i;
            return i;
          }
        }
        return -1;
      },
      { timeout: 20_000 },
    )
    .not.toBe(-1);
  return found;
}

/** Takes the first word on offer and returns it. */
async function pickWord(page: Page): Promise<string> {
  await pickerOf(page).getByRole('button').first().click();
  const slip = page.getByTestId('secret-word');
  await expect(slip).toBeVisible();
  return (await slip.locator('strong').innerText()).trim();
}

const metrics = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollHeight: Math.max(doc.scrollHeight, document.body.scrollHeight),
      scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    };
  });

/** Fails with the numbers when the page scrolls in either direction. */
async function expectNoPageScroll(page: Page, label: string) {
  await expect
    .poll(
      async () => {
        const m = await metrics(page);
        return m.scrollHeight <= m.innerHeight + 1 && m.scrollWidth <= m.innerWidth + 1
          ? 'fits'
          : `${label}: scroll ${m.scrollWidth}x${m.scrollHeight} in ${m.innerWidth}x${m.innerHeight}`;
      },
      { timeout: 4000 },
    )
    .toBe('fits');
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  return b!;
}

type Box = { x: number; y: number; width: number; height: number };

function expectInViewport(b: Box, page: Page, label: string) {
  const { width, height } = page.viewportSize()!;
  expect(b.x, `${label} left`).toBeGreaterThanOrEqual(-1);
  expect(b.y, `${label} top`).toBeGreaterThanOrEqual(-1);
  expect(b.x + b.width, `${label} right`).toBeLessThanOrEqual(width + 1);
  expect(b.y + b.height, `${label} bottom`).toBeLessThanOrEqual(height + 1);
}

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}

/** Everything a player needs, on screen, at this viewport. Returns the canvas size. */
async function expectFits(page: Page, vp: Viewport, role: 'drawer' | 'guesser') {
  const label = `${role} ${vp.width}x${vp.height}`;
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await expectNoPageScroll(page, label);

  const canvas = page.getByTestId('drawing-canvas');
  await expect(canvas).toBeVisible();
  const c = await box(canvas);
  expectInViewport(c, page, `${label} canvas`);
  if (role === 'drawer')
    expect(c.width, `${label} canvas width`).toBeGreaterThanOrEqual(vp.minCanvas);

  const input = page.getByLabel('Guess or chat');
  await expect(input).toBeVisible();
  expectInViewport(await box(input), page, `${label} chat input`);

  // Every name is in the players region (a strip may scroll sideways, but the names are there).
  const players = (await page.getByRole('complementary', { name: 'Players' }).textContent()) ?? '';
  for (const name of NAMES) expect(players, `${label} players`).toContain(name);

  if (role === 'drawer') {
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    const u = await box(undo);
    expectInViewport(u, page, `${label} undo`);
    expect(overlaps(u, c), `${label} undo overlaps the canvas`).toBe(false);

    // Wide rows show every swatch; narrow ones fold them behind a colour button.
    const trigger = page.getByRole('button', { name: 'Pick colour' });
    const targets = (await trigger.isVisible())
      ? [trigger]
      : await page.getByRole('group', { name: 'Colour' }).getByRole('button').all();
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      const b = await box(t);
      expectInViewport(b, page, `${label} colour control`);
      expect(overlaps(b, c), `${label} colour control overlaps the canvas`).toBe(false);
    }
    const bar = await box(page.getByRole('toolbar', { name: 'Drawing tools' }));
    expect(bar.width, `${label} toolbar is as wide as the sheet`).toBeLessThanOrEqual(c.width + 6);
    expect(bar.height, `${label} toolbar height`).toBeLessThanOrEqual(56);
  }

  // Sheet height: on desktop layouts nothing may be left empty under the sheet and its toolbar (or
  // note) unless the window is too narrow to grow the sheet any further.
  if (vp.width >= 900 && vp.height >= 500) {
    const stage = await box(page.locator('.stage'));
    const board = await box(page.locator('.board'));
    const gap = vp.height - (board.y + board.height);
    expect(
      gap <= 24 || c.width >= stage.width - 8,
      `${label}: ${Math.round(gap)}px empty under the sheet`,
    ).toBe(true);
  }
  return { width: Math.round(c.width), height: Math.round(c.height) };
}

/** A veil (picker, results, podium) sits inside the sheet; anything longer scrolls inside it. */
async function expectVeilInSheet(page: Page, veil: Locator, label: string) {
  await expect(veil).toBeVisible();
  const v = await box(veil);
  const c = await box(page.getByTestId('drawing-canvas'));
  expect(v.x, `${label} veil left`).toBeGreaterThanOrEqual(c.x - 3);
  expect(v.y, `${label} veil top`).toBeGreaterThanOrEqual(c.y - 3);
  expect(v.x + v.width, `${label} veil right`).toBeLessThanOrEqual(c.x + c.width + 3);
  expect(v.y + v.height, `${label} veil bottom`).toBeLessThanOrEqual(c.y + c.height + 3);
  await expectNoPageScroll(page, label);
}

test.describe.serial('layout with a full room', () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    seats = [];
    for (let i = 0; i < NAMES.length; i++) seats.push(await seat(browser));
    const h = host();
    await h.goto('/');
    await h.getByLabel('Your name').fill(NAMES[0]!);
    await h.getByRole('button', { name: 'Create a private room' }).click();
    code = (await h.getByTestId('room-code').innerText()).replace(/\s/g, '');
    await h.getByRole('slider', { name: 'Max players' }).fill('12');
    // Two rounds keep the walk to the end screen short.
    await h.getByRole('slider', { name: 'Rounds' }).fill('2');
    for (let i = 1; i < NAMES.length; i++) {
      const p = seats[i]!.page;
      await p.goto(`/r/${code}`);
      await p.getByLabel('Your name').fill(NAMES[i]!);
      await p.getByRole('button', { name: `Join room ${code}` }).click();
      await expect(p.getByRole('region', { name: 'Players' })).toContainText(NAMES[0]!);
    }
    await expect(h.getByRole('region', { name: 'Players' }).getByRole('listitem')).toHaveCount(10);
  });

  test.afterAll(async () => {
    await Promise.all(seats.map((s) => s.context.close()));
    seats = [];
  });

  test('the lobby fits a laptop screen with ten players', async () => {
    for (const vp of [LAPTOP, { width: 1024, height: 700 }]) {
      await host().setViewportSize(vp);
      await expectNoPageScroll(host(), `lobby ${vp.width}x${vp.height}`);
      const roster = host().getByRole('region', { name: 'Players' });
      for (const name of NAMES) await expect(roster).toContainText(name);
      await expect(host().getByRole('button', { name: 'Start game' })).toBeInViewport();
      await expect(host().getByLabel('Guess or chat')).toBeInViewport();
    }
    await host().setViewportSize(LAPTOP);
  });

  test('the drawing screen fits every viewport, for the drawer and a guesser', async () => {
    await host().getByRole('button', { name: 'Start game' }).click();
    const d = await drawerIndex();
    const drawer = pages()[d]!;
    const guesser = pages()[(d + 1) % NAMES.length]!;

    // The word picker lies inside the sheet at laptop, phone and phone-landscape sizes.
    for (const vp of [VIEWPORTS[1]!, VIEWPORTS[7]!, VIEWPORTS[8]!]) {
      await drawer.setViewportSize(vp);
      await expectVeilInSheet(drawer, drawer.getByTestId('choosing'), `picker ${vp.width}`);
    }
    turnOne = { page: drawer, word: await pickWord(drawer) };

    const sizes: string[] = [];
    for (const vp of VIEWPORTS) {
      const mine = await expectFits(drawer, vp, 'drawer');
      const theirs = await expectFits(guesser, vp, 'guesser');
      sizes.push(
        `${vp.width}x${vp.height}: drawer ${mine.width}x${mine.height}, guesser ${theirs.width}x${theirs.height}`,
      );
    }
    test.info().annotations.push({ type: 'canvas sizes', description: sizes.join(' | ') });
    console.log(sizes.join('\n'));

    // Phones fold size and colour into popovers that open above the row and stay on screen.
    await drawer.setViewportSize({ width: 390, height: 844 });
    await drawer.getByRole('button', { name: 'Pick colour' }).click();
    const swatch = drawer.getByRole('button', { name: 'Colour #ff0000' });
    await expect(swatch).toBeVisible();
    expectInViewport(await box(swatch), drawer, 'popover swatch');
    await swatch.click();
    await expect(swatch).toBeHidden();
    await drawer.setViewportSize(LAPTOP);
    await guesser.setViewportSize(LAPTOP);
  });

  test('the menu holds dark mode and leaving, and closes on Escape', async () => {
    const page = host();
    const toggle = page.getByRole('button', { name: 'Menu' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const dark = page.getByRole('switch', { name: 'Dark mode' });
    await dark.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoPageScroll(page, 'dark game screen');
    await dark.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Leave room' })).toHaveCount(0);
  });

  test('the end screen fits without page scroll, in both views', async () => {
    // Play every turn quickly: the drawer picks, everyone else types the word.
    const turns = NAMES.length * 2;
    for (let turn = 0; turn < turns; turn++) {
      // The first turn is already under way: the previous test picked its word.
      const drawerPage = turn === 0 ? turnOne.page : pages()[await drawerIndex()]!;
      const word = turn === 0 ? turnOne.word : await pickWord(drawerPage);
      // The gallery keeps only drawings that have ink on them.
      const sheet = await box(drawerPage.getByTestId('drawing-canvas'));
      await drawerPage.mouse.move(sheet.x + sheet.width * 0.2, sheet.y + sheet.height * 0.3);
      await drawerPage.mouse.down();
      await drawerPage.mouse.move(sheet.x + sheet.width * 0.7, sheet.y + sheet.height * 0.6, {
        steps: 4,
      });
      await drawerPage.mouse.up();
      await Promise.all(
        pages()
          .filter((p) => p !== drawerPage)
          .map(async (p) => {
            await p.getByLabel('Guess or chat').fill(word);
            await p.getByLabel('Guess or chat').press('Enter');
          }),
      );
      await expect(drawerPage.getByTestId('reveal')).toBeVisible({ timeout: 15_000 });
      if (turn === 0) {
        // Results list for ten players fits inside the sheet too.
        await expectVeilInSheet(drawerPage, drawerPage.getByTestId('reveal'), 'reveal 1366');
      }
    }

    for (const page of pages().slice(0, 2)) {
      await expect(page.getByTestId('standings')).toBeVisible({ timeout: 20_000 });
      await page.setViewportSize(LAPTOP);
      await expectVeilInSheet(page, page.getByTestId('standings'), 'podium 1366x768');
      await page.getByRole('tab', { name: 'Gallery' }).click();
      await expect(page.getByTestId('gallery')).toBeVisible();
      await expect(page.getByTestId('gallery-card')).toHaveCount(turns);
      await expectNoPageScroll(page, 'gallery 1366x768');
      await page.getByRole('tab', { name: 'Scores' }).click();
      await expect(page.getByTestId('standings')).toBeVisible();
    }
    // A phone-sized podium scrolls inside its sheet, never the page.
    await host().setViewportSize({ width: 390, height: 844 });
    await expectVeilInSheet(host(), host().getByTestId('standings'), 'podium 390x844');
    await host().setViewportSize(LAPTOP);
  });
});
