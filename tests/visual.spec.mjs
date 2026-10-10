import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import { VIEWS, projectsForView } from './pages.mjs';
import { installVisualDeterminism, settle } from './helpers.mjs';

test.describe('visual regression', () => {
  for (const view of VIEWS) {
    // Do not request the `page` fixture up front: Playwright launches the
    // project browser before `test.skip()` runs, so a view that does not
    // apply to this project (invite-ok on mobile-safari, invite-ok-ios on
    // desktop) would fail in 1ms if that browser cannot start.
    test(`${view.slug}`, async ({ playwright }, testInfo) => {
      if (!projectsForView(view).includes(testInfo.project.name)) {
        test.skip();
        return;
      }

      const browserName = testInfo.project.use.browserName || 'chromium';
      const browser = await playwright[browserName].launch();
      const context = await browser.newContext({
        ...testInfo.project.use,
        // A noJs view is rendered with scripting off, so what the shot captures
        // is the <noscript> panel rather than a loading state nothing resolves.
        ...(view.noJs ? { javaScriptEnabled: false } : {}),
      });
      const page = await context.newPage();
      try {
        await installVisualDeterminism(page, { platform: view.platform });
        // Registered after the 503 safety net so this snapshot wins. The body is
        // the published shop list, not the invented preview towns.
        let fixtureBody = null;
        if (view.placesFixture) {
          fixtureBody = readFileSync(new URL(`../${view.placesFixture}`, import.meta.url));
          await page.route(/opencryptopay\.io\/map\/places/, (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: fixtureBody }),
          );
        }
        await page.goto(view.path, { waitUntil: 'load' });
        await settle(page, { scripting: !view.noJs });

        // Confirm-page views render their end state via the ?mock hook after a short
        // delay; wait for it before the shot. The page has no <video>/<canvas>, so no
        // masking is needed and the whole page is byte-compared.
        if (view.waitFor) {
          await page.waitForSelector(`#state-${view.waitFor}:not([hidden])`, {
            state: 'visible',
          });
        }
        if (view.waitFor === 'places') {
          await page.waitForSelector('#pay-map[data-map-ready="true"]', { timeout: 20000 });
        }
        if (view.openFirstPin) {
          const shop = JSON.parse(fixtureBody.toString()).places[0];
          // Neighbouring shops share a point. A coordinate click lands on
          // whichever pin was painted last, so activate this shop on the element.
          await page
            .locator(`#pay-map .pay-pin[aria-label=${JSON.stringify(shop.name)}]`)
            .evaluate((el) => el.click());
          await expect(page.locator('#pay-popup-name')).toHaveText(shop.name);
        }

        await expect(page).toHaveScreenshot(`${view.slug}.png`, { fullPage: true });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
});
