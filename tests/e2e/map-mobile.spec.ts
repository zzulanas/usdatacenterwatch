import { test, expect } from '@playwright/test';

// Regression coverage for the touch-vs-pointer code paths in MapView.tsx.
// PR #26 (touch-aware tooltip) introduced a code path where the deck.gl
// `getCursor` callback was set to `undefined` on touch devices, which
// crashes the entire layer stack with `getCursor is not a function`.
// That bug silently shipped because all prior e2e tests ran on Desktop
// Chrome. This spec runs under iPhone 13 emulation to catch the class of
// "fine on desktop, broken on touch" regressions.

const ALLOWED_CONSOLE_PATTERNS = [
  /maplibre/i,
  /deck\.gl/i,
  /tile/i,
  /Failed to load resource/i,
  /Content Security Policy/i,
  /favicon/i,
  /CORS/i,
  /Access-Control-Allow-Origin/i,
];

function isAllowedNoise(msg: string): boolean {
  return ALLOWED_CONSOLE_PATTERNS.some((re) => re.test(msg));
}

test.describe('MapView on mobile (touch emulation)', () => {
  test('deck.gl layer renders without page errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isAllowedNoise(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    const mapView = page.getByTestId('map-view');
    await expect(mapView).toBeVisible({ timeout: 45_000 });

    const canvas = mapView.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Give deck.gl time to construct and render the ScatterplotLayer.
    await page.waitForTimeout(3000);

    // The "getCursor is not a function" crash manifests as a pageerror at
    // layer-construction time. The exact error message matters less than
    // the fact that ANY pageerror surfaces from deck.gl during normal map
    // mount on touch.
    expect(
      pageErrors,
      `Touch-emulation surfaced ${pageErrors.length} page error(s): ${pageErrors.join(' | ')}`
    ).toEqual([]);

    expect(
      consoleErrors,
      `Touch-emulation surfaced console errors: ${consoleErrors.join('\n')}`
    ).toEqual([]);

    // Verify the deck.gl overlay actually registered the facilities layer.
    // The original crash zeroed-out layerCount because the error fired
    // before layer registration completed.
    const layerCount = await page.evaluate(() => {
      const m = (window as unknown as { __map?: { _controls?: unknown[] } }).__map;
      if (!m) return -1;
      const overlay = (m._controls ?? []).find((c) => c && (c as { _deck?: unknown })._deck) as
        | { _deck?: { layerManager?: { getLayers?: () => unknown[] } } }
        | undefined;
      const layers = overlay?._deck?.layerManager?.getLayers?.() ?? [];
      return layers.length;
    });

    expect(
      layerCount,
      'deck.gl should register the facilities ScatterplotLayer on touch devices'
    ).toBeGreaterThanOrEqual(1);
  });
});
