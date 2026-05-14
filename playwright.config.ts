import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4322);

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
    // Port 4322 by default — local dev uses 4321, so e2e on a separate port lets
    // a developer keep `pnpm dev` open while running tests. Override with
    // PLAYWRIGHT_PORT in environments where 4322 is occupied (parallel worktrees).
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm dev --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Skip mobile-only specs on the desktop project so they don't run twice.
      testIgnore: /.*mobile.*\.spec\.ts/,
    },
    // Mobile-emulation project for the touch-vs-pointer code paths in
    // MapView. PR #26 introduced a touch-only branch where a `getCursor:
    // undefined` choice crashed the entire deck.gl layer stack — the bug
    // shipped because all our prior e2e tests ran on Desktop Chrome.
    // tests/e2e/map-mobile.spec.ts is the regression coverage for that class.
    // Use Chromium with iPhone 13 viewport + touch profile rather than the
    // real WebKit binary — CI already installs Chromium with system deps via
    // `playwright install --with-deps chromium`; adding WebKit would balloon
    // the cache and require additional libs. Chromium-emulated touch is
    // sufficient to catch the touch-vs-pointer code paths in MapView.
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
      },
      testMatch: /.*mobile.*\.spec\.ts/,
    },
  ],
});
