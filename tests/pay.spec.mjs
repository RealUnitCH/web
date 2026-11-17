import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

const PLACES = 'https://api.opencryptopay.io/map/places?blockchain=Ethereum&asset=ZCHF';
const PLACES_ROUTE = /api\.opencryptopay\.io\/map\/places/;

function body(places) {
  return JSON.stringify({ places });
}

const MATCH = {
  name: 'Bern',
  category: 'Café',
  lat: 46.9,
  lon: 7.4,
  supports: [{ blockchain: 'Ethereum', asset: 'ZCHF' }],
};

const OTHER = {
  name: 'Manila',
  category: 'Shop',
  lat: 14.6,
  lon: 120.98,
  supports: [{ blockchain: 'Lightning', asset: 'BTC' }],
};

test.describe('pay locations', () => {
  test('a preview mock does not call the place service', async ({ page }) => {
    let calls = 0;
    await page.route(/opencryptopay\.io/, () => {
      calls += 1;
    });
    await page.goto('/pay/?mock=places');
    await expect(page.locator('#state-places')).toBeVisible();
    await expect(page.locator('#state-places h1')).toHaveText('Mit der RealUnit Wallet bezahlen');
    await expect(page.locator('[data-i18n="places.body"]')).toHaveText(
      'Die Karte zeigt, wo die veröffentlichten Geschäfte liegen. Der Name erscheint am ausgewählten Punkt.',
    );
    await expect(page.locator('#pay-map .pay-pin')).toHaveCount(3, { timeout: 20_000 });
    await expect(page.locator('#pay-map canvas')).toHaveAttribute('aria-label', 'Karte');
    await expect(page.locator('#pay-map .maplibregl-ctrl-zoom-in')).toHaveAttribute(
      'aria-label',
      'Vergrössern',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-zoom-out')).toHaveAttribute(
      'aria-label',
      'Verkleinern',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-compass')).toHaveAttribute(
      'aria-label',
      'Norden ausrichten',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-attrib-button')).toHaveAttribute(
      'aria-label',
      'Quellen einblenden',
    );
    await expect(page.locator('#pay-popup')).toBeHidden();
    await expect(page.locator('#pay-means')).toBeVisible();
    await expect(page.locator('#pay-means')).toContainText('nicht direkt mit Ihren Aktien');
    await expect(page.locator('#pay-means')).toContainText('ZCHF');
    await expect(page.locator('#pay-means')).toContainText('nicht gutgeschrieben');
    await expect(page.locator('#pay-means')).not.toContainText('bleibt als ZCHF');
    await expect(page.locator('#pay-means')).not.toContainText('zuerst verwendet');
    expect(calls).toBe(0);
  });

  test('the selected preview pin shows its name and category and no shop list', async ({
    page,
  }) => {
    await page.goto('/pay/?mock=place');
    await expect(page.locator('#pay-popup-name')).toHaveText('Zürich');
    await expect(page.locator('#pay-popup-category')).toHaveText('Lebensmittel');
    await expect(page.locator('#pay-map')).not.toContainText('Zürich');
    await page.locator('#pay-popup-close').click();
    await expect(page.locator('#pay-popup')).toBeHidden();
  });

  test('empty and error mocks stay off the network', async ({ page }) => {
    let calls = 0;
    await page.route(/opencryptopay\.io/, () => {
      calls += 1;
    });
    await page.goto('/pay/?mock=empty');
    await expect(page.locator('#state-empty')).toBeVisible();
    await expect(page.locator('#pay-means')).toBeHidden();
    await page.goto('/pay/?mock=error');
    await expect(page.locator('#state-error')).toBeVisible();
    await page.goto('/pay/?mock=loading');
    await expect(page.locator('#state-loading')).toBeVisible();
    expect(calls).toBe(0);
  });

  test('the published snapshot shows the real shops, not the preview towns', async ({ page }) => {
    const raw = readFileSync(new URL('./fixtures/published-places.json', import.meta.url), 'utf8');
    const published = JSON.parse(raw);
    const shop = published.places[0];
    await page.route(PLACES_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: raw }),
    );
    await page.goto('/pay/');
    await expect(page.locator('#pay-map .pay-pin')).toHaveCount(published.places.length, {
      timeout: 20_000,
    });
    // The same shops the app baseline lists, present here as pins rather than a list.
    await expect(
      page.locator('#pay-map .pay-pin[aria-label="SPAR Auwiesenstrasse 24, 9030 Abtwil"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('#pay-map .pay-pin[aria-label="SPAR Schmiedgasse 10, 6460 Altdorf"]'),
    ).toHaveCount(1);
    for (const town of ['Zürich', 'Bern', 'Lugano']) {
      await expect(page.locator(`#pay-map .pay-pin[aria-label="${town}"]`)).toHaveCount(0);
    }
    // Neighbouring shops share a point. A coordinate click lands on whichever
    // pin was painted last, so activate this shop on the element itself.
    await page
      .locator(`#pay-map .pay-pin[aria-label=${JSON.stringify(shop.name)}]`)
      .evaluate((el) => el.click());
    await expect(page.locator('#pay-popup-name')).toHaveText(shop.name);
    await expect(page.locator('#pay-popup-category')).toHaveText(shop.category);
    await expect(page.locator('#pay-map')).not.toContainText(shop.name);
  });

  test('the English page uses the English copy', async ({ page }) => {
    await page.goto('/pay/en/?mock=places');
    await expect(page).toHaveTitle('RealUnit — Pay locations');
    await expect(page.locator('#state-places h1')).toHaveText('Pay with the RealUnit Wallet');
    await expect(page.locator('[data-i18n="places.body"]')).toHaveText(
      'The map shows where the published shops are. The name appears on the selected point.',
    );
    await expect(page.locator('#pay-means')).toBeVisible();
    await expect(page.locator('#pay-means')).toContainText('do not pay with your shares');
    await expect(page.locator('#pay-means')).toContainText('ZCHF');
    await expect(page.locator('#pay-means')).toContainText('not credited to you');
    await expect(page.locator('#pay-means')).not.toContainText('stays as ZCHF');
    await expect(page.locator('#pay-means')).not.toContainText('used first');
    await expect(page.locator('#pay-map canvas')).toHaveAttribute('aria-label', 'Map', {
      timeout: 20_000,
    });
    await expect(page.locator('#pay-map .maplibregl-ctrl-zoom-in')).toHaveAttribute(
      'aria-label',
      'Zoom in',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-zoom-out')).toHaveAttribute(
      'aria-label',
      'Zoom out',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-compass')).toHaveAttribute(
      'aria-label',
      'Reset bearing to north',
    );
    await expect(page.locator('#pay-map .maplibregl-ctrl-attrib-button')).toHaveAttribute(
      'aria-label',
      'Toggle attribution',
    );
  });

  test('a live list keeps only an exact Ethereum and ZCHF pin', async ({ page }) => {
    await page.route(PLACES_ROUTE, (route) => {
      expect(route.request().url()).toBe(PLACES);
      expect(route.request().method()).toBe('GET');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: body([OTHER, MATCH]),
      });
    });
    await page.goto('/pay/');
    await expect(page.locator('#pay-map .pay-pin')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('#pay-map .pay-pin')).toHaveAttribute('aria-label', 'Bern');
    await page.locator('#pay-map .pay-pin').click();
    await expect(page.locator('#pay-popup-name')).toHaveText('Bern');
    await expect(page.locator('#pay-popup-category')).toHaveText('Café');
  });

  test('a readable list with nothing to keep is the empty state', async ({ page }) => {
    await page.route(PLACES_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: body([OTHER]) }),
    );
    await page.goto('/pay/');
    await expect(page.locator('#state-empty')).toBeVisible();
  });

  test('a failed response, a bad body, and a non-list body are the error state', async ({
    page,
  }) => {
    await page.route(PLACES_ROUTE, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/pay/');
    await expect(page.locator('#state-error')).toBeVisible();

    await page.unroute(PLACES_ROUTE);
    await page.route(PLACES_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }),
    );
    await page.locator('#pay-retry').click();
    await expect(page.locator('#state-error')).toBeVisible();

    await page.unroute(PLACES_ROUTE);
    await page.route(PLACES_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"places":{}}' }),
    );
    await page.locator('#pay-retry').click();
    await expect(page.locator('#state-error')).toBeVisible();
  });
});
