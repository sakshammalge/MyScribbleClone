import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: `http://localhost:${port}`,
    // Lets sandboxes with a preinstalled browser skip `playwright install`.
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: 'npm run build && npm start',
    env: { PORT: String(port), INKLING_TIME_SCALE: '0.1' },
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
