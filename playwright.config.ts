import { defineConfig } from '@playwright/test';

// The e2e suite runs the app on its own port and database so it never touches dev.db
// or collides with a `npm run dev` already running on 3000.
const PORT = 3100;
const APP_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './e2e/output/test-results',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // Each test launches its own Chromium with the extension; they share one app server.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: APP_URL },
  webServer: {
    command: `npx prisma db push --skip-generate && npx next dev -p ${PORT}`,
    url: `${APP_URL}/api/reports?limit=1`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'file:./e2e.db',
      NEXT_PUBLIC_APP_URL: APP_URL,
      MOTH70_E2E_URL: APP_URL,
    },
  },
});
