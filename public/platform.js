/* Sets data-platform="ios" | "android" on <html> so the CSS can enlarge the
   matching store badge. Loaded synchronously in <head> so the attribute is in
   place before first paint (no layout shift). Desktop/unknown — and no-JS —
   get no attribute and keep the equal-size badge row. */
(function () {
  var ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    document.documentElement.setAttribute("data-platform", "android");
  } else if (/iPad|iPhone|iPod/.test(ua) ||
      // iPadOS reports a Macintosh UA, but real Macs have no touch screen
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    document.documentElement.setAttribute("data-platform", "ios");
  }
})();
