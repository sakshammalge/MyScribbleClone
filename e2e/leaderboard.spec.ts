import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface Player {
  name: string;
  page: Page;
  context: BrowserContext;
}

// The server keeps stats for its whole run, so every test names its players uniquely.
const tag = () => Math.random().toString(36).slice(2, 7);

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  return { name, context, page: await context.newPage() };
}

const choices = (p: Player) =>
  p.page.getByRole('group', { name: 'Choose a word' }).getByRole('button');

async function pick(p: Player) {
  await expect(choices(p)).toHaveCount(3);
  const word = (await choices(p).first().innerText()).trim();
  await choices(p).first().click();
  await expect(p.page.getByTestId('secret-word')).toContainText(word);
  return word;
}

async function guess(p: Player, text: string) {
  await p.page.getByLabel('Guess or chat').fill(text);
  await p.page.getByRole('button', { name: 'Send' }).click();
}

/** Two people, two rounds, everything guessed: four turns to the final standings. */
async function playFullGame(host: Player, other: Player, rematch = false) {
  if (rematch) {
    await host.page.getByRole('button', { name: 'Play again' }).click();
  } else {
    await host.page.goto('/');
    await host.page.getByLabel('Your name').fill(host.name);
    await host.page.getByRole('button', { name: 'Create a private room' }).click();
    const code = (await host.page.getByTestId('room-code').innerText()).replace(/\s/g, '');
    await other.page.goto(`/r/${code}`);
    await other.page.getByLabel('Your name').fill(other.name);
    await other.page.getByRole('button', { name: `Join room ${code}` }).click();
    await expect(host.page.getByRole('listitem').filter({ hasText: other.name })).toBeVisible();
    await host.page.getByRole('slider', { name: 'Rounds' }).fill('2');
    await host.page.getByRole('button', { name: 'Start game' }).click();
  }
  for (let turn = 0; turn < 4; turn++) {
    const [drawer, guesser] = turn % 2 === 0 ? [host, other] : [other, host];
    const word = await pick(drawer);
    await guess(guesser, word);
    await expect(guesser.page.getByTestId('reveal')).toContainText(word);
  }
  for (const p of [host, other]) await expect(p.page.getByTestId('standings')).toBeVisible();
}

/** A fresh tab on the same browser profile: same device, but no seat held in a room. */
async function openLeaderboard(p: Player) {
  p.page = await p.context.newPage();
  await p.page.goto('/');
  await p.page.getByRole('button', { name: /Leaderboard/ }).click();
  await expect(p.page).toHaveURL(/\/leaderboard$/);
}

test('finished games build per-device stats and an all-time leaderboard', async ({ browser }) => {
  test.setTimeout(120_000);
  const ada = await newPlayer(browser, `Ada${tag()}`);
  const bo = await newPlayer(browser, `Bo${tag()}`);

  // Before any game, the stats card says so.
  await openLeaderboard(ada);
  await expect(ada.page.getByTestId('my-stats-empty')).toBeVisible();

  await playFullGame(ada, bo);
  await playFullGame(ada, bo, true);

  await openLeaderboard(ada);
  const stats = ada.page.getByTestId('my-stats');
  await expect(stats).toBeVisible();
  const stat = (label: string) => stats.locator('div', { hasText: label }).locator('dd').first();
  await expect(stat('Games played')).toHaveText('2');
  await expect(stat('Words drawn')).toHaveText('4');
  await expect(stat('Correct guesses')).toHaveText('4');
  await expect(stat('Drawings guessed')).toHaveText('4');
  expect(Number((await stat('Total points').innerText()).replace(/,/g, ''))).toBeGreaterThan(0);

  // Everyone who has played shows up, and only the viewer's own row is marked.
  const row = (p: Player) => ada.page.getByTestId('leaderboard').getByRole('row', { name: p.name });
  await expect(row(ada)).toContainText('you');
  await expect(row(bo)).toBeVisible();
  await expect(row(bo)).not.toContainText('you');
  await expect(row(ada).getByRole('cell').nth(2)).toHaveText('2');

  // The other tabs sort the same players differently without breaking.
  await ada.page.getByRole('tab', { name: 'Points' }).click();
  await expect(ada.page.getByRole('tab', { name: 'Points' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row(ada)).toBeVisible();
  await ada.page.getByRole('tab', { name: 'Games played' }).click();
  await expect(row(bo)).toBeVisible();

  // The identity is remembered across reloads, and the id never appears in any response.
  const deviceId = await ada.page.evaluate(() => localStorage.getItem('inkling.device'));
  expect(deviceId).toMatch(/^[0-9a-f]{32}$/);
  const body = await ada.page.evaluate(async () => {
    const res = await fetch('/api/leaderboard?sort=wins&limit=100');
    return res.text();
  });
  expect(body).not.toContain(deviceId!);
  await ada.page.reload();
  await expect(ada.page.getByTestId('my-stats')).toBeVisible();
  await expect(row(ada)).toContainText('you');

  // A different browser profile is a different player: nothing of Ada's is theirs.
  const visitor = await newPlayer(browser, 'Visitor');
  await openLeaderboard(visitor);
  await expect(visitor.page.getByTestId('my-stats-empty')).toBeVisible();
  await expect(
    visitor.page.getByTestId('leaderboard').getByText('you', { exact: true }),
  ).toHaveCount(0);

  await Promise.all([ada, bo, visitor].map((p) => p.context.close()));
});

test('the stats API only reads: bad input is refused and nothing can be posted', async ({
  request,
}) => {
  expect((await request.get('/api/stats/me')).status()).toBe(400);
  expect(
    (await request.get('/api/stats/me', { headers: { 'x-device-id': 'nope' } })).status(),
  ).toBe(400);
  const mine = await request.get('/api/stats/me', { headers: { 'x-device-id': 'f'.repeat(32) } });
  expect(await mine.json()).toEqual({ stats: null });
  expect((await request.post('/api/stats', { data: { wins: 99 } })).status()).toBe(404);
  const board = await request.get('/api/leaderboard?sort=bogus&limit=100000');
  expect(board.status()).toBe(200);
  expect((await board.json()).entries.length).toBeLessThanOrEqual(100);
});
