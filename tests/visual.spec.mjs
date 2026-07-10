import { expect, test } from '@playwright/test';
import { VIEWS, projectsForView } from './pages.mjs';
import { installVisualDeterminism, settle } from './helpers.mjs';

test.describe('visual regression', () => {
  for (const view of VIEWS) {
    test(`${view.slug}`, async ({ page }, testInfo) => {
      test.skip(
        !projectsForView(view).includes(testInfo.project.name),
        `view "${view.slug}" does not apply to ${testInfo.project.name}`,
      );

      await installVisualDeterminism(page, { platform: view.platform });
      await page.goto(view.path, { waitUntil: 'load' });
      await settle(page);

      // Confirm-page views render their end state via the ?mock hook after a short
      // delay; wait for it before the shot. The page has no <video>/<canvas>, so no
      // masking is needed and the whole page is byte-compared.
      if (view.waitFor) {
        await page.waitForSelector(`#state-${view.waitFor}:not([hidden])`, { state: 'visible' });
      }

      await expect(page).toHaveScreenshot(`${view.slug}.png`, { fullPage: true });
    });
  }
});
