import { test, expect } from '@playwright/test';

test('homepage renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/US Data Center Watch/i);
  await expect(page.getByTestId('map-placeholder')).toBeVisible();
  await expect(page.getByRole('button', { name: /Filters?/i })).toBeVisible();
});

test('methodology page renders', async ({ page }) => {
  await page.goto('/methodology');
  // Use main content h1 to avoid Astro dev toolbar elements
  await expect(page.locator('main h1')).toBeVisible();
});

test('about page renders', async ({ page }) => {
  await page.goto('/about');
  // Use main content h1 to avoid Astro dev toolbar elements
  await expect(page.locator('main h1')).toBeVisible();
});

test('facility dynamic route renders', async ({ page }) => {
  await page.goto('/facility/test-slug');
  // Use main content h1 to avoid Astro dev toolbar elements
  const h1 = page.locator('main h1');
  await expect(h1).toBeVisible();
  await expect(h1).toContainText('test-slug');
});

test('dark mode is the default', async ({ page }) => {
  await page.goto('/');
  const htmlClass = await page.locator('html').getAttribute('class');
  expect(htmlClass).toMatch(/dark/);
});

test('no island JS for the homepage Button (W2 verification)', async ({ page }) => {
  // Collect all JS resources loaded on first navigation
  const jsUrls: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('.js') || url.endsWith('.mjs')) {
      jsUrls.push(url);
    }
  });

  await page.goto('/');
  // Wait for the page to fully settle
  await page.waitForLoadState('networkidle');

  // The Button component should not have shipped a dedicated client JS chunk.
  // We check that no URL matches a "button-*.js" pattern (Astro island chunk naming).
  const buttonIslandJs = jsUrls.filter((url) => /button[^/]*\.js/i.test(url));
  expect(
    buttonIslandJs,
    `Unexpected Button island JS loaded: ${buttonIslandJs.join(', ')}`
  ).toHaveLength(0);
});
