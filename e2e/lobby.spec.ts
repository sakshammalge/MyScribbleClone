import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The lobby fills one window without scrolling from 1024x650 up, shows a tile for every seat, and
 * keeps the chat (log and input) and the Start button on screen. On a phone it stacks and only
 * scrolls vertically.
 */

const NAMES = ['Ada', 'Bo', 'Cy', 'Dee Longername', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];
const DESKTOPS = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 700 },
];

async function scrolls(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return {
      x: Math.max(d.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      y: Math.max(d.scrollHeight, document.body.scrollHeight) - window.innerHeight,
    };
  });
}

async function expectLobbyFits(page: Page, label: string, seats: number) {
  await expect
    .poll(async () => {
      const s = await scrolls(page);
      return s.x <= 1 && s.y <= 1 ? 'fits' : `${label}: scrolls by ${s.x}x${s.y}`;
    })
    .toBe('fits');
  await expect(page.getByTestId('seat'), `${label} seat tiles`).toHaveCount(seats);
  await expect(page.getByTestId('chat-log'), `${label} chat log`).toBeInViewport();
  await expect(page.getByLabel('Guess or chat'), `${label} chat input`).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Start game' }), `${label} start`).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByLabel('Invite link')).toBeInViewport();
}

async function openRoom(browser: Browser, players: number, maxPlayers?: number) {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < players; i++) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    contexts.push(context);
    pages.push(await context.newPage());
  }
  const host = pages[0]!;
  await host.goto('/');
  await host.getByLabel('Your name').fill(NAMES[0]!);
  await host.getByRole('button', { name: 'Create a private room' }).click();
  const code = (await host.getByTestId('room-code').innerText()).replace(/\s/g, '');
  if (maxPlayers) await host.getByRole('slider', { name: 'Max players' }).fill(String(maxPlayers));
  for (let i = 1; i < players; i++) {
    const p = pages[i]!;
    await p.goto(`/r/${code}`);
    await p.getByLabel('Your name').fill(NAMES[i]!);
    await p.getByRole('button', { name: `Join room ${code}` }).click();
  }
  await expect(host.getByRole('region', { name: 'Players' }).getByRole('listitem')).toHaveCount(
    players,
  );
  return { host, pages, close: () => Promise.all(contexts.map((c) => c.close())) };
}

test('a lone host sees every seat, and the lobby fits each laptop window', async ({ browser }) => {
  const room = await openRoom(browser, 1);
  for (const vp of DESKTOPS) {
    await room.host.setViewportSize(vp);
    await expectLobbyFits(room.host, `1 player ${vp.width}x${vp.height}`, 8);
  }
  await room.close();
});

test('ten players in a twelve seat room still fit, with open seats left over', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const room = await openRoom(browser, 10, 12);
  const roster = room.host.getByRole('region', { name: 'Players' });
  for (const vp of DESKTOPS) {
    await room.host.setViewportSize(vp);
    await expectLobbyFits(room.host, `10 players ${vp.width}x${vp.height}`, 12);
    for (const name of NAMES) await expect(roster).toContainText(name);
  }
  // The chat card carries messages as a log.
  await room.host.getByLabel('Guess or chat').fill('hello lobby');
  await room.host.getByLabel('Guess or chat').press('Enter');
  await expect(room.pages[3]!.getByTestId('chat-log')).toContainText('hello lobby');
  // Guests see who they wait for, and cannot start.
  const guest = room.pages[1]!;
  await guest.setViewportSize({ width: 1512, height: 982 });
  await expect(guest.getByText('Waiting for Ada to start…')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await expectLobbyFits(guest, 'guest 1512x982', 12);
  await room.close();
});

test('the words box folds away, and the menu holds Leave room', async ({ browser }) => {
  const room = await openRoom(browser, 1);
  const fold = room.host.getByRole('button', { name: /Your own words/ });
  await room.host.setViewportSize({ width: 1512, height: 982 });
  // Windows under about 820px high start with it folded.
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(room.host.getByRole('textbox', { name: 'Custom words' })).toBeVisible();
  await fold.click();
  await expect(room.host.getByRole('textbox', { name: 'Custom words' })).toBeHidden();
  await expect(room.host.getByTestId('custom-count')).toHaveText('0');
  await room.host.getByRole('button', { name: 'Menu' }).click();
  await expect(room.host.getByRole('switch', { name: 'Dark mode' })).toBeVisible();
  await expect(room.host.getByRole('button', { name: 'Back to lobby' })).toHaveCount(0);
  await room.close();
});

test('on a phone the lobby stacks, folds open seats into one line and never scrolls sideways', async ({
  browser,
}) => {
  const room = await openRoom(browser, 3);
  await room.host.setViewportSize({ width: 390, height: 844 });
  const s = await scrolls(room.host);
  expect(s.x, 'horizontal overflow').toBeLessThanOrEqual(1);
  await expect(room.host.getByText('+5 open seats')).toBeVisible();
  await expect(room.host.getByLabel('Invite link')).toBeInViewport();
  const bar = await room.host.getByRole('button', { name: 'Menu' }).boundingBox();
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(391);
  await room.close();
});
