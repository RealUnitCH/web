import { expect, test } from '@playwright/test';
import { PAGES } from './pages.mjs';
import { blockDfxApi } from './helpers.mjs';

test.describe('static site smoke checks', () => {
  for (const path of PAGES) {
    test(`${path} loads, renders and has no uncaught script errors`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await blockDfxApi(page);

      const response = await page.goto(path);
      expect(response?.ok()).toBeTruthy();

      await expect(page.locator('body')).toBeVisible();

      const title = await page.title();
      expect(title.trim().length).toBeGreaterThan(0);

      const overflow = await page.evaluate(() => {
        const documentWidth = document.documentElement.scrollWidth;
        const viewportWidth = document.documentElement.clientWidth;
        return documentWidth - viewportWidth;
      });
      expect(overflow).toBeLessThanOrEqual(2);

      expect(pageErrors).toEqual([]);
    });
  }

  test('an unknown path serves the custom 404 page with a 404 status', async ({ page }) => {
    const response = await page.goto('/does-not-exist-x9y8z7');
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText('Seite nicht gefunden');
  });
});
