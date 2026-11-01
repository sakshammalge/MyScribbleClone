import { expect, test } from '@playwright/test';

/** The face editor on the home screen: choices persist, sync to other players, and fit a phone. */

test('custom faces persist, reach other players, and fit laptop and phone, light and dark', async ({
  browser,
}) => {
  const shots = process.env.AVATAR_SHOTS;
  const hostCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const host = await hostCtx.newPage();
  await host.goto('/');
  await host.getByLabel('Your name').fill('Ada');

  await host.getByRole('tab', { name: 'Hair', exact: true }).click();
  await host.getByRole('radio', { name: 'Hair 4' }).click();
  await host.getByRole('tab', { name: 'Hair colour' }).click();
  await host.getByRole('radio', { name: 'Hair colour 9' }).click();
  await host.getByRole('tab', { name: 'Skin' }).click();
  await host.getByRole('radio', { name: 'Skin 6' }).click();
  await host.getByRole('tab', { name: 'Extras' }).click();
  await host.getByRole('radio', { name: 'Extras 2' }).click();
  await host.getByRole('tab', { name: 'Backdrop' }).click();
  await host.getByRole('radio', { name: 'Backdrop 3' }).click();
  if (shots) await host.screenshot({ path: `${shots}/home-light-1366.png` });

  // The choice survives a reload (localStorage).
  await host.reload();
  await expect(host.getByLabel('Your name')).toHaveValue('Ada');
  await host.getByRole('tab', { name: 'Skin' }).click();
  await expect(host.getByRole('radio', { name: 'Skin 6' })).toBeChecked();

  await host.getByRole('button', { name: 'Create a private room' }).click();
  const code = (await host.getByTestId('room-code').innerText()).replace(/\s/g, '');
  const mine = await host
    .getByRole('region', { name: 'Players' })
    .locator('svg.avatar')
    .first()
    .innerHTML();

  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestCtx.newPage();
  await guest.goto(`/r/${code}`);
  await guest.getByLabel('Your name').fill('Bo');
  if (shots) await guest.screenshot({ path: `${shots}/home-phone-390.png` });
  await guest.getByRole('button', { name: `Join room ${code}` }).click();
  const roster = guest.getByRole('region', { name: 'Players' });
  await expect(roster.getByRole('listitem')).toHaveCount(2);
  // The guest sees Ada's exact drawing: same SVG markup apart from generated ids.
  const strip = (s: string) => s.replace(/:r[0-9a-z]+:/g, 'ID');
  const seen = await roster.locator('svg.avatar').first().innerHTML();
  expect(strip(seen)).toBe(strip(mine));
  if (shots) {
    await guest.screenshot({ path: `${shots}/lobby-phone-390.png` });
    await host.screenshot({ path: `${shots}/lobby-light-1366.png` });
    await host.emulateMedia({ colorScheme: 'dark' });
    await host.screenshot({ path: `${shots}/lobby-dark-1366.png` });
  }
  await hostCtx.close();
  await guestCtx.close();
});
