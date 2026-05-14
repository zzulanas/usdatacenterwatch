/**
 * filters.spec.ts — E2E coverage for the USD-18 filter sidebar.
 *
 * Covers:
 *   1. Desktop sidebar is collapsed by default, opens on toggle
 *   2. Selecting a status chip updates the URL with the s= param
 *   3. Filter URL params survive a page reload
 *   4. Closing the facility panel does NOT strip filter params
 *      (the URL coexistence fix flagged by staff-engineer)
 *   5. "Clear all" wipes filter params but preserves ?f=
 */

import { test, expect } from '@playwright/test';

const ALLOWED_CONSOLE_PATTERNS = [
  /maplibre/i,
  /deck\.gl/i,
  /tile/i,
  /Failed to load resource/i,
  /Content Security Policy/i,
  /favicon/i,
  /CORS/i,
  /Access-Control-Allow-Origin/i,
  /PUBLIC_R2_BASE_URL/i,
];

function isAllowedNoise(msg: string): boolean {
  return ALLOWED_CONSOLE_PATTERNS.some((re) => re.test(msg));
}

test.describe('MapFilters (USD-18)', () => {
  test('desktop sidebar is collapsed by default and opens on toggle', async ({ page }) => {
    await page.goto('/');

    const mapView = page.getByTestId('map-view');
    await expect(mapView).toBeVisible({ timeout: 45_000 });

    // The sidebar element exists in DOM but is translated off-screen initially.
    const sidebar = page.getByTestId('desktop-filter-sidebar');
    await expect(sidebar).toHaveAttribute('data-open', 'false', { timeout: 10_000 });

    // Click the right-edge toggle.
    const toggle = page.getByTestId('desktop-filter-toggle');
    await toggle.click();

    await expect(sidebar).toHaveAttribute('data-open', 'true', { timeout: 3_000 });

    // Click again → closes.
    await toggle.click();
    await expect(sidebar).toHaveAttribute('data-open', 'false', { timeout: 3_000 });
  });

  test('selecting a status chip writes s= to the URL', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isAllowedNoise(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });

    // Wait for filter store hydration (facilities + facets ready).
    await page.waitForFunction(
      () => {
        const sidebar = document.querySelector('[data-testid="desktop-filter-sidebar"]');
        return sidebar !== null;
      },
      { timeout: 15_000 }
    );

    // Open the sidebar.
    await page.getByTestId('desktop-filter-toggle').click();

    // Toggle the "Operational" chip OFF (it's selected by default).
    const operationalChip = page.getByTestId('filter-status-operational');
    await expect(operationalChip).toHaveAttribute('data-active', 'true');
    await operationalChip.click();
    await expect(operationalChip).toHaveAttribute('data-active', 'false', { timeout: 3_000 });

    // URL should now have s= reflecting the remaining default statuses
    // (under_construction, announced — but NOT operational).
    await expect
      .poll(() => new URL(page.url()).searchParams.get('s'), { timeout: 3_000 })
      .toContain('under_construction');

    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
  });

  test('filter URL params survive a page reload', async ({ page }) => {
    // Start with a filter URL.
    await page.goto('/?s=operational');
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });

    // Wait for hydration to run.
    await page.waitForTimeout(2500);

    // Open the sidebar.
    await page.getByTestId('desktop-filter-toggle').click();

    // The "Operational" chip should be selected and the others NOT — the URL
    // override took effect, not the default status set.
    await expect(page.getByTestId('filter-status-operational')).toHaveAttribute(
      'data-active',
      'true'
    );
    await expect(page.getByTestId('filter-status-under_construction')).toHaveAttribute(
      'data-active',
      'false'
    );

    // Reload — URL persists naturally.
    await page.reload();
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(2500);
    await page.getByTestId('desktop-filter-toggle').click();
    await expect(page.getByTestId('filter-status-operational')).toHaveAttribute(
      'data-active',
      'true'
    );
    await expect(page.getByTestId('filter-status-under_construction')).toHaveAttribute(
      'data-active',
      'false'
    );
  });

  test('closing the facility panel preserves filter URL params (coexistence fix)', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isAllowedNoise(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    // Both filter param AND panel pre-open param in URL.
    await page.goto('/?o=Meta&f=meta-prineville-or');
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });

    const panel = page.getByTestId('facility-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText('Prineville');

    // Close via ESC.
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible({ timeout: 3_000 });

    // URL must drop f= but keep o=Meta — that's the bug staff-engineer flagged.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('o'), { timeout: 3_000 })
      .toBe('Meta');
    expect(new URL(page.url()).searchParams.get('f')).toBeNull();

    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
  });

  test('"Clear all" removes filter params but does not affect ?f=', async ({ page }) => {
    await page.goto('/?o=Meta&f=meta-prineville-or');
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });

    // Wait for panel + sidebar to be ready.
    await expect(page.getByTestId('facility-panel')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    await page.getByTestId('desktop-filter-toggle').click();

    const clearBtn = page.getByTestId('clear-filters');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // o= dropped, f= preserved.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('o'), { timeout: 3_000 })
      .toBeNull();
    expect(new URL(page.url()).searchParams.get('f')).toBe('meta-prineville-or');
  });

  test('Showing N of M counter reflects the active filter', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 45_000 });

    // Wait for facilities to load + hydration.
    await page.waitForTimeout(2500);

    await page.getByTestId('desktop-filter-toggle').click();

    // Grab the visible/total counts before filtering.
    const counterBefore = await page
      .getByTestId('desktop-filter-sidebar')
      .locator('text=/Showing.*facilities/')
      .first()
      .textContent();
    expect(counterBefore).toMatch(/Showing \d+ of \d+ facilities/);

    // Toggle off operational — visible count must change.
    await page.getByTestId('filter-status-operational').click();
    await page.waitForTimeout(500);

    const counterAfter = await page
      .getByTestId('desktop-filter-sidebar')
      .locator('text=/Showing.*facilities/')
      .first()
      .textContent();
    expect(counterAfter).toMatch(/Showing \d+ of \d+ facilities/);
    expect(counterAfter).not.toBe(counterBefore);
  });
});
