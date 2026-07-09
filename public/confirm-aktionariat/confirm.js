(function () {
  'use strict';

  // --- i18n (de default, en) ---
  var I18N = {
    de: {
      'doc.title': 'RealUnit — Adressbestätigung',
      'doc.desc': 'Bestätigung Ihrer RealUnit-Wallet-Adresse.',
      'loading.title': 'Bestätigung läuft…',
      'loading.body': 'Einen Moment, wir bestätigen Ihre Wallet-Adresse.',
      'confirmed.title': 'Adresse bestätigt',
      'confirmed.desktop': 'Ihre RealUnit-Wallet-Adresse ist bestätigt. Kehren Sie auf Ihrem Smartphone zur RealUnit-App zurück.',
      'confirmed.mobile': 'Ihre RealUnit-Wallet-Adresse ist bestätigt.',
      'confirmed.cta': 'Zurück zur App',
      'invalid.title': 'Link ungültig oder abgelaufen',
      'invalid.body': 'Dieser Bestätigungslink ist ungültig oder bereits abgelaufen. Bitte fordern Sie in der App einen neuen an.',
      'unavailable.title': 'Dienst vorübergehend nicht erreichbar',
      'unavailable.body': 'Wir konnten die Bestätigung gerade nicht abschliessen. Bitte versuchen Sie es in ein paar Minuten erneut.',
      'unavailable.cta': 'Erneut versuchen',
    },
    en: {
      'doc.title': 'RealUnit — Address confirmation',
      'doc.desc': 'Confirm your RealUnit wallet address.',
      'loading.title': 'Confirming…',
      'loading.body': 'One moment — we’re confirming your wallet address.',
      'confirmed.title': 'Address confirmed',
      'confirmed.desktop': 'Your RealUnit wallet address is confirmed. Return to the RealUnit app on your phone.',
      'confirmed.mobile': 'Your RealUnit wallet address is confirmed.',
      'confirmed.cta': 'Back to the app',
      'invalid.title': 'Link invalid or expired',
      'invalid.body': 'This confirmation link is invalid or has already expired. Please request a new one in the app.',
      'unavailable.title': 'Service temporarily unavailable',
      'unavailable.body': 'We couldn’t complete the confirmation right now. Please try again in a few minutes.',
      'unavailable.cta': 'Try again',
    },
  };

  var params = new URLSearchParams(window.location.search);
  var host = window.location.hostname;
  var isRealUnitHost = host === 'realunit.app' || host === 'www.realunit.app' || host === 'dev.realunit.app';

  var lang = (params.get('lang') || navigator.language || 'de').slice(0, 2).toLowerCase();
  if (!I18N[lang]) lang = 'de';
  document.documentElement.lang = lang;
  var t = I18N[lang];

  // Apply translations: text content, alt text, aria-label, and document meta.
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var v = t[el.getAttribute('data-i18n')];
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-alt]').forEach(function (el) {
    var v = t[el.getAttribute('data-i18n-alt')];
    if (v) el.setAttribute('alt', v);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
    var v = t[el.getAttribute('data-i18n-aria')];
    if (v) el.setAttribute('aria-label', v);
  });
  if (t['doc.title']) document.title = t['doc.title'];
  var descEl = document.querySelector('meta[name="description"]');
  if (descEl && t['doc.desc']) descEl.setAttribute('content', t['doc.desc']);

  // --- API base URL, derived explicitly from host (no silent default) ---
  function apiBase() {
    if (host === 'realunit.app' || host === 'www.realunit.app') return 'https://api.dfx.swiss';
    if (host === 'dev.realunit.app') return 'https://dev.api.dfx.swiss';
    // local preview / unknown host: allow ?api= override, else DEV.
    return params.get('api') || 'https://dev.api.dfx.swiss';
  }

  // The return-to-app hand-off uses a fixed custom URL scheme, realunit-wallet://open,
  // hard-coded on the button in the markup — no host derivation needed. realunit.app
  // claims no Universal/App Link, so the confirmation email always reaches this web
  // page; the app registers the scheme to re-open itself after confirmation.

  var STATES = ['loading', 'confirmed', 'invalid', 'unavailable'];
  function show(state) {
    STATES.forEach(function (s) {
      document.getElementById('state-' + s).hidden = s !== state;
    });
  }

  // The confirmed state's copy is chosen purely in CSS from html[data-platform]
  // (set by platform.js before first paint): a phone gets the "back to the app"
  // button (the realunit-wallet:// scheme only resolves on the device), while a
  // desktop — where the scheme opens nothing — is told to return on its phone.
  function render(status) {
    if (status === 'confirmed') {
      show('confirmed');
    } else if (status === 'invalid') {
      show('invalid');
    } else {
      show('unavailable');
    }
  }

  function confirm() {
    show('loading');

    // Mock hook for LOCAL preview only (?mock=confirmed|invalid|unavailable).
    // Never honored on the real realunit.app / dev.realunit.app hosts, so a
    // shared prod link cannot render a spoofed confirmation screen.
    var mock = params.get('mock');
    if (mock && !isRealUnitHost) {
      setTimeout(function () {
        render(mock);
      }, 400);
      return;
    }

    var email = params.get('email');
    var code = params.get('code');
    var user = params.get('user');
    if (!email || !code || !user) {
      show('invalid');
      return;
    }

    var url =
      apiBase() +
      '/v1/realunit/confirm-aktionariat' +
      '?email=' + encodeURIComponent(email) +
      '&code=' + encodeURIComponent(code) +
      '&user=' + encodeURIComponent(user);

    // Abort a stalled request so the spinner can never hang forever.
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 15000);

    fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then(function (res) {
        return res
          .json()
          .then(function (body) {
            return { ok: res.ok, body: body };
          })
          .catch(function () {
            return { ok: res.ok, body: {} };
          });
      })
      .then(function (r) {
        clearTimeout(timeoutId);
        // Any non-2xx from the DFX API itself (validation 400, rate-limit 429,
        // 5xx) is a transient/unknown state → retryable, never a rejection.
        if (!r.ok) {
          render('unavailable');
          return;
        }
        var status = r.body && r.body.status;
        if (status === 'confirmed' || status === 'invalid' || status === 'unavailable') render(status);
        else render('unavailable');
      })
      .catch(function () {
        clearTimeout(timeoutId);
        render('unavailable'); // network error / timeout (abort) → retryable
      });
  }

  document.getElementById('retry').addEventListener('click', confirm);
  confirm();
})();
