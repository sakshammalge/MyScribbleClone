import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

const PORT = 3110;

function startServer(): { child: ChildProcess; output: () => string } {
  let log = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/main.ts'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
  });
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  return { child, output: () => log };
}

async function waitHealthy() {
  await expect
    .poll(async () => (await fetch(`http://localhost:${PORT}/healthz`).catch(() => null))?.ok, {
      timeout: 30_000,
    })
    .toBe(true);
}

const exited = (child: ChildProcess) =>
  new Promise<number | string | null>((resolve) =>
    child.once('exit', (code, signal) => resolve(code ?? signal)),
  );

test('a server restart ends the room with a clear message; SIGTERM exits cleanly', async ({
  page,
}) => {
  const first = startServer();
  await waitHealthy();
  // Hosted mode: no LAN banner.
  expect(first.output()).not.toContain('Share this');

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByLabel('Your name').fill('Survivor');
  await page.getByRole('button', { name: 'Create a private room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();

  const done = exited(first.child);
  first.child.kill('SIGTERM');
  expect(await done).toBe(0);

  const second = startServer();
  try {
    await waitHealthy();
    await expect(page.getByRole('alert')).toContainText('server restarted', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Create a private room' })).toBeVisible();
  } finally {
    second.child.kill('SIGKILL');
  }
});
