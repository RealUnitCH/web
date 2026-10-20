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
        // delay; wait for it before the shot. The pay map paints live OpenFreeMap
        // tiles. The label raster is not byte-stable: the same page has failed
        // CI by 2 pixels and by 573, both inside the map. Mask #pay-map and
        // allow exactly its border box, measured on the committed baselines
        // (558x320 on desktop and tablet, 311x320 on mobile). The mask paints
        // that rectangle on the actual shot, so the diff is the map. The suite
        // ratio is zero, so these shots also lift the ratio; the pixel budget
        // is what binds, and a pixel outside the map still fails. Every other
        // shot stays exact.
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

        const screenshot = { fullPage: true };
        if (view.waitFor === 'places') {
          // Border box of #pay-map in tests/__screenshots__, CSS pixels.
          const mapPixels = {
            'desktop-chromium': 558 * 320,
            'tablet-chromium': 558 * 320,
            'mobile-safari': 311 * 320,
          }[testInfo.project.name];
          if (mapPixels === undefined) {
            throw new Error(`no pay-map pixel budget for ${testInfo.project.name}`);
          }
          screenshot.mask = [page.locator('#pay-map')];
          screenshot.maxDiffPixels = mapPixels;
          screenshot.maxDiffPixelRatio = 1;
        }
        await expect(page).toHaveScreenshot(`${view.slug}.png`, screenshot);
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
});
