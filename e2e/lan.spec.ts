import { networkInterfaces } from 'node:os';
import { expect, test } from '@playwright/test';

const lanIp = Object.values(networkInterfaces())
  .flatMap((infos) => infos ?? [])
  .find((info) => info.family === 'IPv4' && !info.internal)?.address;

test.describe('LAN play', () => {
  test.skip(!lanIp, 'this machine has no non-loopback IPv4 address');

  test('a teammate on the LAN address joins the host on localhost, and the host can remove them', async ({
    browser,
    baseURL,
  }) => {
    const port = new URL(baseURL!).port;
    const lanUrl = `http://${lanIp}:${port}`;

    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext({ baseURL: lanUrl });
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await host.goto('/');
    await host.getByLabel('Your name').fill('Hosty');
    await host.getByRole('button', { name: 'Create a private room' }).click();
    const code = (await host.getByTestId('room-code').innerText()).replace(/\s/g, '');

    // The guest only knows the LAN link, exactly like a teammate on another machine.
    await guest.goto(`/r/${code}`);
    expect(guest.url().startsWith(lanUrl)).toBe(true);
    await guest.getByLabel('Your name').fill('Guesty');
    await guest.getByRole('button', { name: `Join room ${code}` }).click();
    await expect(host.getByRole('listitem').filter({ hasText: 'Guesty' })).toBeVisible();
    await expect(guest.getByRole('listitem').filter({ hasText: 'Hosty' })).toBeVisible();

    // Only the host sees the remove control.
    await expect(guest.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await host.getByRole('button', { name: 'Remove Guesty' }).click();
    await expect(host.getByRole('listitem').filter({ hasText: 'Guesty' })).toHaveCount(0);
    await expect(guest.getByRole('alert')).toContainText('removed you');

    // The removed name cannot sneak back in.
    await guest.goto(`/r/${code}`);
    await guest.getByLabel('Your name').fill('guesty');
    await guest.getByRole('button', { name: `Join room ${code}` }).click();
    await expect(guest.getByRole('alert')).toContainText('removed you');

    await hostCtx.close();
    await guestCtx.close();
  });
});
