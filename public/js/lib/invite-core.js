/**
 * Pure, side-effect-free helpers + copy shared by invite/invite.js.
 *
 * Loaded as a classic script *before* invite.js so window.RealUnitInvite exists
 * when invite.js runs. Kept free of DOM/network access so it can be unit-tested
 * in isolation with 100% coverage (see test/invite-core.test.mjs); the DOM and
 * fetch glue stays in invite.js and is covered by the Playwright functional
 * suite.
 */
(function (global) {
  'use strict';

  var SUPPORTED_LANGS = ['de', 'en'];

  // The host names realunit.app is served under. On these the local-preview mock
  // hook is refused and the API base is fixed, so a shared production link can
  // neither render a spoofed landing nor be pointed at an arbitrary API.
  var REALUNIT_HOSTS = ['realunit.app', 'www.realunit.app', 'dev.realunit.app'];

  var APP_STORE_URL = 'https://apps.apple.com/ch/app/realunit/id6759720010';
  var PLAY_STORE_BASE = 'https://play.google.com/store/apps/details?id=swiss.realunit.app';
  var SITE_ORIGIN = 'https://realunit.app';

  // Copy for every state, German (authored) + English. Both languages carry the
  // exact same keys — test/invite-core.test.mjs enforces parity and that every
  // data-i18n key used in the page is present here.
  var I18N = {
    de: {
      'doc.title': 'RealUnit — Einladung',
      'doc.desc': 'Persönliche Einladung zur RealUnit-App.',
      'loading.title': 'Einladung wird geladen…',
      'loading.body': 'Einen Moment, wir laden deine Einladung.',
      'invite.title': 'Willkommen bei RealUnit',
      'invite.greeting': 'Hey {guestName}, {hostDisplayName} lädt dich ein zu RealUnit.',
      'promo.title': 'Aktion',
      'invalid.title': 'Link ungültig oder abgelaufen',
      'invalid.body':
        'Dieser Einladungslink ist ungültig oder bereits abgelaufen. Bitte fordere in der App einen neuen an, oder tippe den Code manuell ein.',
      'unavailable.title': 'Dienst vorübergehend nicht erreichbar',
      'unavailable.body':
        'Wir konnten die Einladung gerade nicht laden. Bitte versuche es in ein paar Minuten erneut.',
      'unavailable.cta': 'Erneut versuchen',
      'cta.openApp': 'App öffnen',
      'cta.desktop':
        'Öffne diesen Link auf deinem Smartphone, um die RealUnit-App zu starten oder herunterzuladen.',
      'stores.nav': 'App herunterladen',
      'stores.apple.aria': 'RealUnit im App Store laden',
      'stores.apple.alt': 'Laden im App Store',
      'stores.play.aria': 'RealUnit jetzt bei Google Play',
      'stores.play.alt': 'Jetzt bei Google Play',
    },
    en: {
      'doc.title': 'RealUnit — Invite',
      'doc.desc': 'Personal invite to the RealUnit app.',
      'loading.title': 'Loading invite…',
      'loading.body': 'One moment — we’re loading your invite.',
      'invite.title': 'Welcome to RealUnit',
      'invite.greeting': 'Hey {guestName}, {hostDisplayName} is inviting you to RealUnit.',
      'promo.title': 'Promotion',
      'invalid.title': 'Link invalid or expired',
      'invalid.body':
        'This invite link is invalid or has already expired. Please request a new one in the app, or enter the code manually.',
      'unavailable.title': 'Service temporarily unavailable',
      'unavailable.body':
        'We couldn’t load the invite right now. Please try again in a few minutes.',
      'unavailable.cta': 'Try again',
      'cta.openApp': 'Open app',
      'cta.desktop': 'Open this link on your phone to launch or download the RealUnit app.',
      'stores.nav': 'Download the app',
      'stores.apple.aria': 'Get RealUnit on the App Store',
      'stores.apple.alt': 'Download on the App Store',
      'stores.play.aria': 'Get RealUnit on Google Play',
      'stores.play.alt': 'Get it on Google Play',
    },
  };

  function normalizeLang(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.slice(0, 2).toLowerCase();
  }

  // Resolve the active language. A present ?lang= is authoritative: it is
  // validated and, if unsupported, falls back to the default WITHOUT consulting
  // the browser language — the browser is only a fallback when no ?lang= is given.
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

  // Last non-empty path segment after `/invite/`. `/invite/` and `/invite` alone
  // yield an empty string (invalid, no fetch). Query strings are not part of the
  // pathname and are ignored here.
  function extractCode(pathname) {
    if (typeof pathname !== 'string' || !pathname) {
      return '';
    }
    var parts = pathname.split('/').filter(function (p) {
      return p.length > 0;
    });
    var inviteIdx = -1;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === 'invite') {
        inviteIdx = i;
        break;
      }
    }
    if (inviteIdx === -1) {
      return '';
    }
    var after = parts.slice(inviteIdx + 1);
    if (after.length === 0) {
      return '';
    }
    return after[after.length - 1];
  }

  function buildLandingUrl(base, code) {
    return base + '/v1/realunit/referral/landing/' + encodeURIComponent(code);
  }

  // Map an API response to a UI state. 404 is a hard invalid link; any other
  // non-2xx (5xx, network-shaped callers) is unavailable. On 2xx the body's
  // `kind` decides Invite vs Promo; anything else is unavailable.
  function mapLandingResponse(response) {
    var status = response && response.status;
    if (status === 404) {
      return 'invalid';
    }
    if (!(status >= 200 && status < 300)) {
      return 'unavailable';
    }
    var kind = response.body && response.body.kind;
    if (kind === 'Invite') {
      return 'invite';
    }
    if (kind === 'Promo') {
      return 'promo';
    }
    return 'unavailable';
  }

  // Fill `{guestName}` / `{hostDisplayName}` in the invite.greeting template.
  function formatInviteGreeting(lang, guestName, hostDisplayName) {
    var template = (I18N[lang] || I18N.de)['invite.greeting'];
    return template
      .replace('{guestName}', guestName == null ? '' : String(guestName))
      .replace('{hostDisplayName}', hostDisplayName == null ? '' : String(hostDisplayName));
  }

  // Promo body: English prefers campaignTextEn, falls back to German campaignText.
  function formatPromoBody(lang, body) {
    var campaignText = body && body.campaignText;
    var campaignTextEn = body && body.campaignTextEn;
    if (lang === 'en') {
      return campaignTextEn || campaignText || '';
    }
    return campaignText || '';
  }

  // Play Store URL; when a code is present, attach an install referrer so the
  // code survives a fresh Android install (`invite=<code>`).
  function playStoreUrl(code) {
    if (code) {
      return PLAY_STORE_BASE + '&referrer=' + encodeURIComponent('invite=' + code);
    }
    return PLAY_STORE_BASE;
  }

  function appStoreUrl() {
    return APP_STORE_URL;
  }

  // Custom-scheme deep link used by the visible "open app" button. Prefer this
  // over the https Universal Link so the CTA works before AASA is live.
  function appSchemeUrl(code) {
    if (code) {
      return 'realunit-wallet://invite/' + code;
    }
    return 'realunit-wallet://open';
  }

  // https self-link for the same invite path (Universal Link target).
  function universalLinkUrl(code) {
    if (code) {
      return SITE_ORIGIN + '/invite/' + code;
    }
    return SITE_ORIGIN + '/invite/';
  }

  global.RealUnitInvite = {
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    I18N: I18N,
    resolveLang: resolveLang,
    isRealUnitHost: isRealUnitHost,
    apiBase: apiBase,
    extractCode: extractCode,
    buildLandingUrl: buildLandingUrl,
    mapLandingResponse: mapLandingResponse,
    formatInviteGreeting: formatInviteGreeting,
    formatPromoBody: formatPromoBody,
    playStoreUrl: playStoreUrl,
    appStoreUrl: appStoreUrl,
    appSchemeUrl: appSchemeUrl,
    universalLinkUrl: universalLinkUrl,
  };
})(window);
