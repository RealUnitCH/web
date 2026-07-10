/**
 * Pure, side-effect-free platform detection shared by platform.js.
 *
 * Loaded as a classic script *before* platform.js so window.RealUnitPlatform
 * exists when platform.js runs. Kept free of DOM access so it can be unit-tested
 * in isolation with 100% coverage (see test/platform-core.test.mjs); the DOM glue
 * (reading navigator, setting html[data-platform]) stays in platform.js and is
 * covered by the Playwright functional/visual suites.
 */
(function (global) {
  'use strict';

  // Classify the visitor's platform from the user-agent string and the touch
  // capability. Returns 'ios' | 'android' | null — desktop/unknown map to null,
  // which keeps the equal-size store-badge layout. iPadOS reports a Macintosh UA,
  // so a Mac UA with more than one touch point is treated as iOS.
  function detectPlatform(userAgent, maxTouchPoints) {
    if (/android/i.test(userAgent)) {
      return 'android';
    }
    var isIosUa = /iPad|iPhone|iPod/.test(userAgent);
    var isIpadOs = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
    if (isIosUa || isIpadOs) {
      return 'ios';
    }
    return null;
  }

  global.RealUnitPlatform = {
    detectPlatform: detectPlatform,
  };
})(window);
