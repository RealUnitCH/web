// Shared helpers for the Playwright suite. Filename has no `spec`/`test` suffix so
// Playwright does not pick it up as a test file.

// User-agent strings that make platform-core classify a page as a given platform,
// independent of the Playwright device preset. maxTouchPoints is forced to a
// touch value so the iPadOS-as-Macintosh branch and the general touch assumptions
// hold. Applied via addInitScript (runs before any page script) so platform.js,
// which reads navigator in <head>, sees the forced values before first paint.
const PLATFORM_UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

export async function forcePlatform(page, platform) {
  const userAgent = PLATFORM_UA[platform];
  if (!userAgent) {
    throw new Error(`forcePlatform: unknown platform "${platform}"`);
  }
  await page.addInitScript((ua) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
  }, userAgent);
}

// Fulfil any request to the DFX API with a 503 so a test can never make a live
// call. The visual views use the ?mock hook and never fetch; this is a safety net
// so a stray request renders deterministically instead of hitting the network.
export async function blockDfxApi(page) {
  await page.route(/(^|\.)dfx\.swiss\//, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
}

// Visual-only setup: pin reduced motion so the spinner/transitions settle, block
// the DFX API, and optionally force a platform.
export async function installVisualDeterminism(page, { platform } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockDfxApi(page);
  if (platform) {
    await forcePlatform(page, platform);
  }
}

// Wait until the page has reached a stable visual state: network idle, fonts
// ready, and a short settle so any state transition (the ?mock hook renders after
// ~400ms) has landed.
export async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(600);
}
