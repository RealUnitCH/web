/* Sets data-platform="ios" | "android" on <html> so the CSS can enlarge the
   matching store badge (index) / pick the confirmed-state copy (confirm page).
   Loaded synchronously in <head>, after js/lib/platform-core.js, so the attribute
   is in place before first paint (no layout shift). Desktop/unknown — and no-JS —
   get no attribute and keep the equal-size / desktop layout. */
(function () {
  'use strict';
  var platform = window.RealUnitPlatform.detectPlatform(
    navigator.userAgent,
    navigator.maxTouchPoints,
  );
  if (platform) {
    document.documentElement.setAttribute('data-platform', platform);
  }
})();
