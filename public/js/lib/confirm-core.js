/**
 * Pure, side-effect-free helpers + copy shared by
 * confirm-aktionariat/confirm.js.
 *
 * Loaded as a classic script *before* confirm.js so window.RealUnitConfirm exists
 * when confirm.js runs. Kept free of DOM/network access so it can be unit-tested
 * in isolation with 100% coverage (see test/confirm-core.test.mjs); the DOM and
 * fetch glue stays in confirm.js and is covered by the Playwright functional
 * suite.
 */
(function (global) {
  'use strict';

  var SUPPORTED_LANGS = ['de', 'en'];

  // The host names realunit.app is served under. On these the local-preview mock
  // hook is refused and the API base is fixed, so a shared production link can
  // neither render a spoofed confirmation nor be pointed at an arbitrary API.
  var REALUNIT_HOSTS = ['realunit.app', 'www.realunit.app', 'dev.realunit.app'];

  // Copy for every state, German (authored) + English. Both languages carry the
  // exact same keys — test/confirm-core.test.mjs enforces parity and that every
  // data-i18n key used in the page is present here.
  var I18N = {
    de: {
      'doc.title': 'RealUnit — Adressbestätigung',
      'doc.desc': 'Bestätigung Ihrer RealUnit-Wallet-Adresse.',
      'loading.title': 'Bestätigung läuft…',
      'loading.body': 'Einen Moment, wir bestätigen Ihre Wallet-Adresse.',
      'confirmed.title': 'Adresse bestätigt',
      'confirmed.desktop':
        'Ihre RealUnit-Wallet-Adresse ist bestätigt. Kehren Sie auf Ihrem Smartphone zur RealUnit-App zurück.',
      'confirmed.mobile': 'Ihre RealUnit-Wallet-Adresse ist bestätigt.',
      'confirmed.cta': 'Zurück zur App',
      'invalid.title': 'Link ungültig oder abgelaufen',
      'invalid.body':
        'Dieser Bestätigungslink ist ungültig oder bereits abgelaufen. Bitte fordern Sie in der App einen neuen an.',
      'unavailable.title': 'Dienst vorübergehend nicht erreichbar',
      'unavailable.body':
        'Wir konnten die Bestätigung gerade nicht abschliessen. Bitte versuchen Sie es in ein paar Minuten erneut.',
      'unavailable.cta': 'Erneut versuchen',
    },
    en: {
      'doc.title': 'RealUnit — Address confirmation',
      'doc.desc': 'Confirm your RealUnit wallet address.',
      'loading.title': 'Confirming…',
      'loading.body': 'One moment — we’re confirming your wallet address.',
      'confirmed.title': 'Address confirmed',
      'confirmed.desktop':
        'Your RealUnit wallet address is confirmed. Return to the RealUnit app on your phone.',
      'confirmed.mobile': 'Your RealUnit wallet address is confirmed.',
      'confirmed.cta': 'Back to the app',
      'invalid.title': 'Link invalid or expired',
      'invalid.body':
        'This confirmation link is invalid or has already expired. Please request a new one in the app.',
      'unavailable.title': 'Service temporarily unavailable',
      'unavailable.body':
        'We couldn’t complete the confirmation right now. Please try again in a few minutes.',
      'unavailable.cta': 'Try again',
    },
  };

  // Two-letter, lower-cased language tag; '' for a missing/non-string value.
  function normalizeLang(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.slice(0, 2).toLowerCase();
  }

  // Resolve the active language. A present ?lang= is authoritative: it is
  // validated and, if unsupported, falls back to the default WITHOUT consulting
  // the browser language — the browser is only a fallback when no ?lang= is given.
  // This mirrors the original short-circuit `(urlLang || navigatorLang ||
  // default)` + supported check. Both urlLang and navigatorLang may be
  // null/undefined (no param / no navigator.language) — treated as absent, and an
  // empty ?lang= (`?lang=`) falls through to the browser just like the original.
  function resolveLang(options) {
    var supported = options.supported;
    var fromUrl = normalizeLang(options.urlLang);
    if (fromUrl) {
      return supported.indexOf(fromUrl) !== -1 ? fromUrl : options.defaultLang;
    }
    var fromNavigator = normalizeLang(options.navigatorLang);
    if (supported.indexOf(fromNavigator) !== -1) {
      return fromNavigator;
    }
    return options.defaultLang;
  }

  function isRealUnitHost(host) {
    return REALUNIT_HOSTS.indexOf(host) !== -1;
  }

  // Resolve the DFX API base for a host. Production hosts are fixed; on a local
  // preview / unknown host an explicit ?api= override wins, else DEV. There is no
  // silent production default — an unknown host is deliberately pointed at DEV.
  function apiBase(options) {
    var host = options.host;
    if (host === 'realunit.app' || host === 'www.realunit.app') {
      return 'https://api.dfx.swiss';
    }
    if (host === 'dev.realunit.app') {
      return 'https://dev.api.dfx.swiss';
    }
    if (options.paramApi) {
      return options.paramApi;
    }
    return 'https://dev.api.dfx.swiss';
  }

  // True only when all three link params are present and non-empty.
  function hasRequiredParams(params) {
    return Boolean(params.email && params.code && params.user);
  }

  // Build the confirmation endpoint URL, encoding each param. The email is
  // lower-cased before encoding: confirmation links can arrive with a mixed-case
  // address (mail clients, manual copy) and the address is matched case-
  // insensitively, so normalizing here avoids a spurious 400 that would surface
  // to the user as a misleading "temporarily unavailable" loop. code and user are
  // opaque, case-sensitive tokens and are left untouched.
  function buildConfirmUrl(base, params) {
    return (
      base +
      '/v1/realunit/confirm-aktionariat' +
      '?email=' +
      encodeURIComponent(String(params.email).toLowerCase()) +
      '&code=' +
      encodeURIComponent(params.code) +
      '&user=' +
      encodeURIComponent(params.user)
    );
  }

  // Build the durable-logging endpoint URL for the confirm lifecycle events. Same
  // DFX API host as the confirm GET, so it is already covered by the page CSP's
  // connect-src — no _headers change is needed.
  function buildEventUrl(base) {
    return base + '/v1/realunit/confirm-aktionariat/event';
  }

  // Build the JSON body for a lifecycle event. `phase` is always present; each of
  // email/code/user is included only when it was actually present on the link
  // (so a missing-params event carries just the subset that was there), and
  // `detail` only when supplied (e.g. an error kind). The params are logged
  // verbatim — the durable log is the diagnostic PII store, so it records exactly
  // what the link carried (case included), independent of the lower-casing the
  // confirm request applies.
  function buildEventBody(phase, params, detail) {
    var body = { phase: phase };
    var p = params || {};
    if (p.email) {
      body.email = p.email;
    }
    if (p.code) {
      body.code = p.code;
    }
    if (p.user) {
      body.user = p.user;
    }
    if (detail) {
      body.detail = detail;
    }
    return body;
  }

  // Map an API response to a UI state. Any non-2xx (validation 400, rate-limit
  // 429, 5xx) is a transient/unknown state → 'unavailable' (retryable), never a
  // hard rejection. On 2xx the body's own status decides, and an unrecognized
  // status is treated as unavailable rather than trusted.
  function mapResult(response) {
    if (!response.ok) {
      return 'unavailable';
    }
    var status = response.body && response.body.status;
    if (status === 'confirmed' || status === 'invalid' || status === 'unavailable') {
      return status;
    }
    return 'unavailable';
  }

  global.RealUnitConfirm = {
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    I18N: I18N,
    resolveLang: resolveLang,
    isRealUnitHost: isRealUnitHost,
    apiBase: apiBase,
    hasRequiredParams: hasRequiredParams,
    buildConfirmUrl: buildConfirmUrl,
    buildEventUrl: buildEventUrl,
    buildEventBody: buildEventBody,
    mapResult: mapResult,
  };
})(window);
