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
    await expect(page.locator('#pay-map button')).toHaveCount(3);
    await expect(page.locator('#pay-popup')).toBeHidden();
    await expect(page.locator('#pay-means')).toBeVisible();
    await expect(page.locator('#pay-means')).toContainText('nicht mit Ihren Aktien');
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

  test('the English page uses the English copy', async ({ page }) => {
    await page.goto('/pay/en/?mock=places');
    await expect(page).toHaveTitle('RealUnit — Pay locations');
    await expect(page.locator('#state-places h1')).toHaveText('Where you can pay with RealUnit');
    await expect(page.locator('#pay-means')).toBeVisible();
    await expect(page.locator('#pay-means')).toContainText('do not pay with your shares');
    await expect(page.locator('#pay-means')).toContainText('ZCHF');
    await expect(page.locator('#pay-means')).toContainText('not credited to you');
    await expect(page.locator('#pay-means')).not.toContainText('stays as ZCHF');
    await expect(page.locator('#pay-means')).not.toContainText('used first');
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
    await expect(page.locator('#pay-map button')).toHaveCount(1);
    await expect(page.locator('#pay-map button')).toHaveAttribute('aria-label', 'Bern');
    await page.locator('#pay-map button').click();
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
