import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface Player {
  name: string;
  page: Page;
  context: BrowserContext;
  /** Every text frame the server sent this player over the socket. */
  frames: string[];
}

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => frames.push(typeof f.payload === 'string' ? f.payload : '')),
  );
  return { name, page, context, frames };
}

async function createRoom(p: Player) {
  await p.page.goto('/');
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: 'Create a private room' }).click();
  const tiles = p.page.getByTestId('room-code');
  await expect(tiles).toBeVisible();
  return (await tiles.innerText()).replace(/\s/g, '');
}

async function joinRoom(p: Player, code: string) {
  await p.page.goto(`/r/${code}`);
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(p.page.getByRole('listitem').filter({ hasText: p.name })).toBeVisible();
}

/** A room of the named players, everyone in the lobby. The first name is the host. */
async function lobby(browser: Browser, ...names: string[]) {
  const players: Player[] = [];
  for (const name of names) players.push(await newPlayer(browser, name));
  const code = await createRoom(players[0]!);
  for (const p of players.slice(1)) await joinRoom(p, code);
  return { players, code, host: players[0]! };
}

const closeAll = (players: Player[]) => Promise.all(players.map((p) => p.context.close()));

const choices = (p: Player) =>
  p.page.getByRole('group', { name: 'Choose a word' }).getByRole('button');

/** What the drawer is offered, then pick by position. Returns the word picked. */
async function pick(p: Player, which: 'first' | 'longest' = 'first') {
  await expect(choices(p)).toHaveCount(3);
  const offered = await choices(p).allInnerTexts();
  const index =
    which === 'first' ? 0 : offered.indexOf([...offered].sort((a, b) => b.length - a.length)[0]!);
  await choices(p).nth(index).click();
  const word = offered[index]!;
  await expect(p.page.getByTestId('secret-word')).toContainText(word);
  return word;
}

const guess = async (p: Player, text: string) => {
  await p.page.getByLabel('Guess or chat').fill(text);
  await p.page.getByRole('button', { name: 'Send' }).click();
};

const log = (p: Player) => p.page.getByTestId('chat-log');
const score = (p: Player, of: string) => p.page.getByTestId(`score-${of}`);

test('a full turn: secret word, guesses checked on the server, points, then the next drawer', async ({
  browser,
}) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo', 'Cy');
  const [ada, bo, cy] = players as [Player, Player, Player];
  await host.page.getByRole('button', { name: 'Start game' }).click();

  // Only the drawer is offered words; everyone else is told who is choosing.
  await expect(choices(ada)).toHaveCount(3);
  await expect(choices(bo)).toHaveCount(0);
  await expect(bo.page.getByTestId('choosing')).toContainText('Ada is choosing a word');
  await expect(bo.page.getByTestId('round')).toHaveText('Round 1 of 3');

  const word = await pick(ada);
  await expect(bo.page.getByTestId('hint')).toBeVisible();
  await expect(bo.page.getByTestId('secret-word')).toHaveCount(0);
  const blanks = [...word].filter((c) => c !== ' ').length;
  await expect(bo.page.getByTestId('hint')).toHaveAttribute(
    'aria-label',
    new RegExp(`${blanks} letters`),
  );
  await expect(bo.page.getByTestId('timer')).toBeVisible();

  // A wrong guess is public; the word has not appeared anywhere a guesser can see.
  await guess(bo, 'qwerty zxcvb');
  await expect(log(cy)).toContainText('Bo qwerty zxcvb');
  const word_re = new RegExp(`\\b${word}\\b`, 'i');
  expect(await bo.page.locator('body').innerText()).not.toMatch(word_re);
  expect(bo.frames.some((f) => word_re.test(f))).toBe(false);
  expect(cy.frames.some((f) => word_re.test(f))).toBe(false);

  // A correct guess scores, announces itself without the word, and hides what comes next.
  await guess(bo, word.toUpperCase());
  await expect(log(cy)).toContainText('Bo found the word!');
  await expect(log(cy)).not.toContainText(word_re);
  await expect(score(bo, 'Bo')).not.toHaveText('0');
  await expect(bo.page.getByTestId('hint')).toBeVisible();
  await guess(bo, 'that was a tricky one');
  await guess(ada, 'well played');
  await expect(log(ada)).toContainText('that was a tricky one');
  await expect(log(bo)).toContainText('well played');
  await guess(cy, 'is it a banana?');
  await expect(log(bo)).toContainText('is it a banana?');
  await expect(log(cy)).not.toContainText('that was a tricky one');
  await expect(log(cy)).not.toContainText('well played');

  // The last guesser ends the turn early: word revealed, points listed, scores updated.
  await guess(cy, word);
  for (const p of players) {
    await expect(p.page.getByTestId('reveal')).toContainText(word);
    await expect(p.page.getByTestId('reveal')).toContainText('Bo');
  }
  const bo_points = Number((await score(ada, 'Bo').innerText()).trim());
  const cy_points = Number((await score(ada, 'Cy').innerText()).trim());
  const ada_points = Number((await score(ada, 'Ada').innerText()).trim());
  expect(bo_points).toBeGreaterThanOrEqual(cy_points);
  expect(cy_points).toBeGreaterThan(100);
  expect(ada_points).toBeGreaterThan(0);

  // Then the pen moves on to Bo, with a clean sheet and fresh choices.
  await expect(choices(bo)).toHaveCount(3);
  await expect(ada.page.getByTestId('choosing')).toContainText('Bo is choosing a word');
  await expect(ada.page.getByTestId('round')).toHaveText('Round 1 of 3');
  await closeAll(players);
});

test('a near miss is nudged privately, and a slow drawer gets a word picked for them', async ({
  browser,
}) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo');
  const [ada, bo] = players as [Player, Player];
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const word = await pick(ada, 'longest');
  if (word.length >= 4) {
    await guess(bo, word.slice(0, -1));
    await expect(log(bo)).toContainText('is so close!');
    await expect(log(ada)).not.toContainText('so close');
    await expect(log(ada)).toContainText(`Bo ${word.slice(0, -1)}`);
  }

  // Ada leaves her turn untouched next time round, so the server chooses for her.
  await guess(bo, word);
  await expect(choices(bo)).toHaveCount(3);
  await expect(bo.page.getByTestId('secret-word')).toHaveCount(0);
  await expect(bo.page.getByTestId('secret-word')).toBeVisible({ timeout: 10_000 });
  await closeAll(players);
});

test('time running out reveals the word, and hints uncover real letters', async ({ browser }) => {
  test.setTimeout(90_000);
  const { players, host } = await lobby(browser, 'Ada', 'Bo');
  const [ada, bo] = players as [Player, Player];
  // The shortest draw time the host can set.
  await host.page.getByRole('slider', { name: 'Draw time' }).fill('30');
  await expect(host.page.getByText('30s')).toBeVisible();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const word = await pick(ada, 'longest');

  const label = () => bo.page.getByTestId('hint').getAttribute('aria-label');
  expect(await label()).toContain('Hint: ' + word.replace(/[a-z0-9]/gi, '_'));
  // The first hint lands at 40% of 30s.
  await expect
    .poll(label, { timeout: 20_000 })
    .not.toContain('Hint: ' + word.replace(/[a-z0-9]/gi, '_') + ',');
  const hinted = ((await label()) ?? '').replace(/^Hint: /, '').split(',')[0]!;
  for (const [i, ch] of [...hinted].entries()) if (ch !== '_') expect(word[i]).toBe(ch);

  await expect(bo.page.getByTestId('reveal')).toContainText(word, { timeout: 30_000 });
  await expect(bo.page.getByTestId('reveal')).toContainText('+0');
  await expect(choices(bo)).toHaveCount(3);
  await closeAll(players);
});

test('plays every round to the final standings, then the host can play again', async ({
  browser,
}) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo');
  const [ada, bo] = players as [Player, Player];
  // Two rounds, two players: four turns.
  await host.page.getByRole('slider', { name: 'Rounds' }).fill('2');
  await host.page.getByRole('button', { name: 'Start game' }).click();

  const seen: string[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const [drawer, guesser] = turn % 2 === 0 ? [ada, bo] : [bo, ada];
    seen.push(drawer.name);
    const word = await pick(drawer);
    await guess(guesser, word);
    await expect(guesser.page.getByTestId('reveal')).toContainText(word);
  }
  expect(seen).toEqual(['Ada', 'Bo', 'Ada', 'Bo']);

  for (const p of players) {
    await expect(p.page.getByTestId('standings')).toBeVisible();
    await expect(p.page.getByTestId('standings')).toContainText('Game over');
    await expect(p.page.getByTestId('round')).toHaveText('Round 2 of 2');
  }
  const first = ada.page.getByTestId('standings').getByRole('listitem').first();
  await expect(first).toContainText(/\d+/);
  await expect(log(bo)).toContainText('Game over!');
  await expect(bo.page.getByRole('button', { name: 'Play again' })).toHaveCount(0);

  await ada.page.getByRole('button', { name: 'Play again' }).click();
  for (const p of players) {
    await expect(p.page.getByRole('button', { name: 'Start game' })).toBeVisible();
  }
  await closeAll(players);
});

test('the host’s own words can replace the built-in list', async ({ browser }) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo');
  const [ada, bo] = players as [Player, Player];
  await expect(bo.page.getByTestId('custom-count')).toHaveText('0');
  await host.page
    .getByRole('textbox', { name: 'Custom words' })
    .fill('zebra crossing\nnebula, tea pot\n  Nebula ');
  await host.page.getByLabel('Use only my words').check();
  await host.page.getByRole('button', { name: 'Save words' }).click();
  await expect(bo.page.getByTestId('custom-count')).toHaveText('3');
  await expect(bo.page.getByText('only the host’s 3 words')).toBeVisible();
  await expect(bo.page.getByRole('textbox', { name: 'Custom words' })).toHaveCount(0);

  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(choices(ada)).toHaveCount(3);
  expect((await choices(ada).allInnerTexts()).sort()).toEqual([
    'nebula',
    'tea pot',
    'zebra crossing',
  ]);
  // Guessing ignores spaces and case in multi-word answers.
  await choices(ada).filter({ hasText: 'zebra crossing' }).click();
  await expect(bo.page.getByTestId('hint')).toHaveAttribute('aria-label', /13 letters/);
  await guess(bo, 'Zebra-Crossing');
  await expect(bo.page.getByTestId('reveal')).toContainText('zebra crossing');
  await closeAll(players);
});

test('a refresh brings back the word, the chat and the clock', async ({ browser }) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo', 'Cy');
  const [ada, bo, cy] = players as [Player, Player, Player];
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const word = await pick(ada);
  await guess(bo, 'qwerty zxcvb');
  await guess(bo, word);
  await guess(bo, 'secret chatter');

  // The drawer still holds the pen and the word.
  await ada.page.reload();
  await expect(ada.page.getByTestId('secret-word')).toContainText(word);
  await expect(ada.page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
  await expect(log(ada)).toContainText('secret chatter');

  // A guesser who found it keeps the insiders' chat; one who did not still cannot see it.
  await bo.page.reload();
  await expect(log(bo)).toContainText('secret chatter');
  await expect(bo.page.getByTestId('hint')).toBeVisible();
  await cy.page.reload();
  await expect(log(cy)).toContainText('qwerty zxcvb');
  await expect(log(cy)).toContainText('Bo found the word!');
  await expect(log(cy)).not.toContainText('secret chatter');
  await expect(cy.page.getByTestId('timer')).toBeVisible();
  expect(cy.frames.some((f) => new RegExp(`\\b${word}\\b`, 'i').test(f))).toBe(false);
  await closeAll(players);
});

test('the pen moves on when the drawer walks out mid-turn', async ({ browser }) => {
  const { players, host } = await lobby(browser, 'Ada', 'Bo', 'Cy');
  const [ada, bo, cy] = players as [Player, Player, Player];
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const word = await pick(ada);
  await ada.page.getByRole('button', { name: 'Leave room' }).click();
  await expect(bo.page.getByTestId('reveal')).toContainText(word);
  await expect(log(cy)).toContainText('Ada left the room.');
  await expect(choices(bo)).toHaveCount(3);
  await expect(bo.page.getByTestId('round')).toHaveText('Round 1 of 3');
  await expect(bo.page.getByTestId('score-Ada')).toHaveCount(0);
  await closeAll(players);
});

test('lobby chat works before the game starts', async ({ browser }) => {
  const { players } = await lobby(browser, 'Ada', 'Bo');
  const [ada, bo] = players as [Player, Player];
  await bo.page.getByLabel('Guess or chat').fill('ready when you are');
  await bo.page.getByRole('button', { name: 'Send' }).click();
  await expect(ada.page.getByTestId('chat-log')).toContainText('Bo ready when you are');
  await closeAll(players);
});

test('the game screen fits a phone for the picker and the guessers', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const code = await createRoom(host);
  const phone = await browser.newContext({
    viewport: { width: 375, height: 760 },
    hasTouch: true,
    isMobile: true,
  });
  const bo: Player = { name: 'Bo', context: phone, page: await phone.newPage(), frames: [] };
  await joinRoom(bo, code);
  await host.page.getByRole('button', { name: 'Start game' }).click();
  const overflow = () =>
    bo.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  await expect(bo.page.getByTestId('choosing')).toBeVisible();
  expect(await overflow()).toBe(false);
  await pick(host);
  await expect(bo.page.getByTestId('hint')).toBeVisible();
  expect(await overflow()).toBe(false);
  await guess(bo, 'a guess on a small screen');
  await expect(bo.page.getByTestId('chat-log')).toContainText('a guess on a small screen');
  expect(await overflow()).toBe(false);
  await closeAll([host, bo]);
});
