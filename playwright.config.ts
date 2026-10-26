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
    env: {
      PORT: String(port),
      INKLING_TIME_SCALE: '0.1',
      // Every test shares one address, so the public-hosting caps are lifted for them.
      INKLING_MAX_CONNECTIONS_PER_IP: '500',
      INKLING_MAX_ROOMS_PER_IP: '500',
    },
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
