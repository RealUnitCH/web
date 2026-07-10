import { expect, test } from '@playwright/test';
import { forcePlatform } from './helpers.mjs';

const CONFIRM_ENDPOINT = '**/v1/realunit/confirm-aktionariat**';

// Fulfil the confirm endpoint with a fixed status/body so the fetch → mapResult →
// render path runs deterministically without a live API call.
async function routeConfirm(page, { status = 200, body = {} } = {}) {
  await page.route(CONFIRM_ENDPOINT, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

test.describe('platform detection', () => {
  test('a desktop visitor gets no data-platform attribute', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop-only');
    await page.goto('/');
    expect(await page.locator('html').getAttribute('data-platform')).toBeNull();
  });

  test('the iPhone device is detected as iOS', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-safari', 'phone-only');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-platform', 'ios');
  });

  for (const platform of ['ios', 'android']) {
    test(`a forced ${platform} user-agent sets html[data-platform="${platform}"]`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chromium', 'runs once on desktop');
      await forcePlatform(page, platform);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-platform', platform);
    });
  }

  test('the landing page links to the App Store, Play Store and the APK release', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'content check, once');
    await page.goto('/');
    await expect(page.locator('a[data-store="apple"]')).toHaveAttribute(
      'href',
      /apps\.apple\.com\/.*id6759720010/,
    );
    await expect(page.locator('a[data-store="play"]')).toHaveAttribute(
      'href',
      /play\.google\.com\/.*id=swiss\.realunit\.app/,
    );
    await expect(page.locator('a[data-store="apk"]')).toHaveAttribute(
      'href',
      /github\.com\/RealUnitCH\/app\/releases\/latest/,
    );
  });
});

test.describe('confirm-aktionariat flow', () => {
  // The confirmation logic is device-agnostic; run it once on desktop.
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop-only confirm-flow checks');
  });

  test('a link without params shows the invalid state and makes no API call', async ({ page }) => {
    const apiCalls = [];
    page.on('request', (request) => {
      if (/dfx\.swiss/.test(request.url())) apiCalls.push(request.url());
    });
    await page.goto('/confirm-aktionariat/');
    await expect(page.locator('#state-invalid')).toBeVisible();
    await expect(page.locator('#state-loading')).toBeHidden();
    expect(apiCalls).toEqual([]);
  });

  for (const state of ['confirmed', 'invalid', 'unavailable']) {
    test(`?mock=${state} renders the ${state} state`, async ({ page }) => {
      await page.goto(`/confirm-aktionariat/?mock=${state}`);
      await expect(page.locator(`#state-${state}`)).toBeVisible();
    });
  }

  test('a valid link confirmed by the API shows the confirmed state and calls the DEV base', async ({
    page,
  }) => {
    let requestedUrl = null;
    await page.route(CONFIRM_ENDPOINT, (route) => {
      requestedUrl = route.request().url();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'confirmed' }),
      });
    });
    await page.goto('/confirm-aktionariat/?email=a%40b.ch&code=CODE1&user=U1');
    await expect(page.locator('#state-confirmed')).toBeVisible();
    expect(requestedUrl).toContain('https://dev.api.dfx.swiss/v1/realunit/confirm-aktionariat');
    expect(requestedUrl).toContain('email=a%40b.ch');
    expect(requestedUrl).toContain('code=CODE1');
    expect(requestedUrl).toContain('user=U1');
  });

  test('a non-2xx API response shows the unavailable state', async ({ page }) => {
    await routeConfirm(page, { status: 500, body: {} });
    await page.goto('/confirm-aktionariat/?email=a%40b.ch&code=C&user=U');
    await expect(page.locator('#state-unavailable')).toBeVisible();
  });

  test('a 200 response with an unrecognized status shows the unavailable state', async ({
    page,
  }) => {
    await routeConfirm(page, { status: 200, body: { status: 'weird' } });
    await page.goto('/confirm-aktionariat/?email=a%40b.ch&code=C&user=U');
    await expect(page.locator('#state-unavailable')).toBeVisible();
  });

  test('the retry button re-runs the confirmation', async ({ page }) => {
    let calls = 0;
    await page.route(CONFIRM_ENDPOINT, (route) => {
      calls += 1;
      const ok = calls > 1; // first attempt fails, the retry succeeds
      route.fulfill({
        status: ok ? 200 : 500,
        contentType: 'application/json',
        body: JSON.stringify(ok ? { status: 'confirmed' } : {}),
      });
    });
    await page.goto('/confirm-aktionariat/?email=a%40b.ch&code=C&user=U');
    await expect(page.locator('#state-unavailable')).toBeVisible();
    await page.locator('#retry').click();
    await expect(page.locator('#state-confirmed')).toBeVisible();
    expect(calls).toBe(2);
  });

  test('?lang=en renders English copy and sets <html lang="en">', async ({ page }) => {
    await page.goto('/confirm-aktionariat/?mock=invalid&lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const expected = await page.evaluate(() => window.RealUnitConfirm.I18N.en['invalid.title']);
    await expect(page.locator('#state-invalid h1')).toHaveText(expected);
  });

  test('an ?api= override sends the confirmation to that API base', async ({ page }) => {
    let requestedUrl = null;
    await page.route(CONFIRM_ENDPOINT, (route) => {
      requestedUrl = route.request().url();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'confirmed' }),
      });
    });
    await page.goto(
      '/confirm-aktionariat/?email=a%40b.ch&code=C&user=U&api=https%3A%2F%2Fapi.example.test',
    );
    await expect(page.locator('#state-confirmed')).toBeVisible();
    expect(requestedUrl).toContain('https://api.example.test/v1/realunit/confirm-aktionariat');
  });
});
