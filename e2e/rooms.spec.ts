import { expect, test, type Browser, type Page } from '@playwright/test';

async function newPlayer(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function createRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create a private room' }).click();
  const tiles = page.getByTestId('room-code');
  await expect(tiles).toBeVisible();
  const code = ((await tiles.innerText()) ?? '').replace(/\s/g, '');
  return code;
}

const roster = (page: Page) => page.getByRole('region', { name: 'Players' }).getByRole('listitem');

test('host creates a room and sees the invite ticket', async ({ page }) => {
  const code = await createRoom(page, 'Ada');
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(page.getByLabel('Invite link')).toHaveValue(new RegExp(`/r/${code}$`));
  await expect(roster(page)).toHaveCount(1);
  await expect(roster(page).first()).toContainText('Ada');
  await expect(roster(page).first()).toContainText('host');
});

test('friends join through the invite link and everyone sees the roster live', async ({
  browser,
}) => {
  const host = await newPlayer(browser);
  const code = await createRoom(host.page, 'Ada');
  const invite = await host.page.getByLabel('Invite link').inputValue();

  const bo = await newPlayer(browser);
  await bo.page.goto(invite);
  await expect(bo.page.getByText(`invited to room ${code}`)).toBeVisible();
  await bo.page.getByLabel('Your name').fill('Bo');
  await bo.page.getByRole('button', { name: `Join room ${code}` }).click();

  const cy = await newPlayer(browser);
  await cy.page.goto('/');
  await cy.page.getByLabel('Your name').fill('Cy');
  await cy.page.getByLabel('Room code').fill(code.toLowerCase());
  await cy.page.getByRole('button', { name: 'Join', exact: true }).click();

  for (const { page } of [host, bo, cy]) {
    await expect(roster(page)).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Players' })).toContainText('Ada');
    await expect(page.getByRole('region', { name: 'Players' })).toContainText('Bo');
    await expect(page.getByRole('region', { name: 'Players' })).toContainText('Cy');
  }

  // Only the host can move settings, and everyone sees the change.
  await expect(bo.page.getByRole('slider', { name: 'Rounds' })).toBeDisabled();
  await host.page.getByRole('slider', { name: 'Rounds' }).fill('7');
  await expect(bo.page.getByRole('region', { name: 'Game settings' })).toContainText('7');

  // Host leaves: the role moves to the next player.
  await host.page.getByRole('button', { name: 'Leave room' }).click();
  await expect(host.page.getByRole('button', { name: 'Create a private room' })).toBeVisible();
  await expect(roster(bo.page)).toHaveCount(2);
  await expect(roster(bo.page).filter({ hasText: 'Bo' })).toContainText('host');
  await expect(bo.page.getByRole('slider', { name: 'Rounds' })).toBeEnabled();

  await Promise.all([host, bo, cy].map((p) => p.context.close()));
});

test('invalid code, duplicate name and refresh recovery', async ({ browser }) => {
  const host = await newPlayer(browser);
  const code = await createRoom(host.page, 'Ada');

  const guest = await newPlayer(browser);
  await guest.page.goto('/r/ZZZZZ');
  await guest.page.getByLabel('Your name').fill('Bo');
  await guest.page.getByRole('button', { name: 'Join room ZZZZZ' }).click();
  await expect(guest.page.getByRole('alert')).toContainText('does not exist');

  await guest.page.goto(`/r/${code}`);
  await guest.page.getByLabel('Your name').fill('ada');
  await guest.page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(guest.page.getByRole('alert')).toContainText('already has this name');

  await guest.page.getByLabel('Your name').fill('Bo');
  await guest.page.getByRole('button', { name: `Join room ${code}` }).click();
  await expect(roster(guest.page)).toHaveCount(2);

  // A refresh reclaims the same seat instead of adding a ghost.
  await guest.page.reload();
  await expect(roster(guest.page)).toHaveCount(2);
  await expect(roster(host.page)).toHaveCount(2);
  await expect(roster(host.page).filter({ hasText: 'reconnecting' })).toHaveCount(0);

  await host.context.close();
  await guest.context.close();
});

test('lobby is usable on a phone-sized screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  await createRoom(page, 'Ada');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await context.close();
});
