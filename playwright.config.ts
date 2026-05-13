import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // workers: 1 — maplibre/deck.gl WebGL cold start in Vite dev mode is not
  // safe to parallelize: miniflare/workerd cold start under @astrojs/cloudflare
  // throws "fetch failed" when hit by concurrent test workers. Revisit if/when
  // we move e2e to run against `pnpm preview` (static dist) instead of dev.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4322',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --port 4322',
    port: 4322,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
