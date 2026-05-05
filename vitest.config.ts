import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Exclude Playwright E2E tests — those run via `pnpm e2e`, not vitest
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
