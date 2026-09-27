import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3301', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'npm run test:serve',
      cwd: fileURLToPath(new URL('../backend', import.meta.url)),
      url: 'http://127.0.0.1:4401/health/ready',
      timeout: 120000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3301',
      url: 'http://127.0.0.1:3301/login',
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4401',
        BACKEND_API_URL: 'http://127.0.0.1:4401',
        APP_ORIGIN: 'http://127.0.0.1:3301',
      },
    },
  ],
});
