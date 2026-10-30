import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:17801',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node test/browser/api-fixture.mjs',
      url: 'http://127.0.0.1:17800/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'npm run start -- --hostname 127.0.0.1 --port 17801',
      url: 'http://127.0.0.1:17801/login',
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        BACKEND_API_URL: 'http://127.0.0.1:17800',
        BACKEND_API_MODE: 'direct',
        APP_ORIGIN: 'http://127.0.0.1:17801',
      },
    },
  ],
});
