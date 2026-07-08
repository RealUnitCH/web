(function () {
  'use strict';

  // --- i18n (de default, en) ---
  var I18N = {
    de: {
      'loading.title': 'Bestätigung läuft…',
      'loading.body': 'Einen Moment, wir bestätigen deine Wallet-Adresse.',
      'confirmed.title': 'Adresse bestätigt',
      'confirmed.body': 'Deine RealUnit-Wallet-Adresse ist jetzt verknüpft. Du kannst in der App fortfahren.',
      'confirmed.cta': 'In der App öffnen',
      'invalid.title': 'Link ungültig oder abgelaufen',
      'invalid.body': 'Dieser Bestätigungslink ist ungültig oder bereits abgelaufen. Bitte fordere in der App einen neuen an.',
      'unavailable.title': 'Dienst vorübergehend nicht erreichbar',
      'unavailable.body': 'Wir konnten die Bestätigung gerade nicht abschliessen. Bitte versuche es in ein paar Minuten erneut.',
      'unavailable.cta': 'Erneut versuchen',
      'stores.hint': 'App noch nicht installiert?',
    },
    en: {
      'loading.title': 'Confirming…',
      'loading.body': 'One moment — we’re confirming your wallet address.',
      'confirmed.title': 'Address confirmed',
      'confirmed.body': 'Your RealUnit wallet address is now linked. You can continue in the app.',
      'confirmed.cta': 'Open in app',
      'invalid.title': 'Link invalid or expired',
      'invalid.body': 'This confirmation link is invalid or has already expired. Please request a new one in the app.',
      'unavailable.title': 'Service temporarily unavailable',
      'unavailable.body': 'We couldn’t complete the confirmation right now. Please try again in a few minutes.',
      'unavailable.cta': 'Try again',
      'stores.hint': 'App not installed yet?',
    },
  };

  var params = new URLSearchParams(window.location.search);
  var lang = (params.get('lang') || navigator.language || 'de').slice(0, 2).toLowerCase();
  if (!I18N[lang]) lang = 'de';
  document.documentElement.lang = lang;
  var t = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });

  // --- API base URL, derived explicitly from host (no silent default) ---
  function apiBase() {
    var h = window.location.hostname;
    if (h === 'realunit.app' || h === 'www.realunit.app') return 'https://api.dfx.swiss';
    if (h === 'dev.realunit.app') return 'https://dev.api.dfx.swiss';
    // local preview / unknown host: allow ?api= override, else DEV.
    return params.get('api') || 'https://dev.api.dfx.swiss';
  }

  var STATES = ['loading', 'confirmed', 'invalid', 'unavailable'];
  function show(state) {
    STATES.forEach(function (s) {
      document.getElementById('state-' + s).hidden = s !== state;
    });
    document.getElementById('stores').hidden = state !== 'confirmed';
  }

  // Return-to-app: universal link back into the app; on desktop / when the app
  // isn't installed the store badges below remain the fallback.
  // TODO(app-links): wire the real deep link once Universal/App Links ship.
  function wireOpenApp() {
    document.getElementById('open-app').setAttribute('href', 'https://realunit.app/');
  }

  function render(status) {
    if (status === 'confirmed') {
      wireOpenApp();
      show('confirmed');
    } else if (status === 'invalid') {
      show('invalid');
    } else {
      show('unavailable');
    }
  }

  function confirm() {
    show('loading');

    // Mock hook for local preview (?mock=confirmed|invalid|unavailable).
    var mock = params.get('mock');
    if (mock) {
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

    fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
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
        var status = r.body && r.body.status;
        if (status === 'confirmed' || status === 'invalid' || status === 'unavailable') render(status);
        else render('unavailable');
      })
      .catch(function () {
        render('unavailable'); // network error → retryable
      });
  }

  document.getElementById('retry').addEventListener('click', confirm);
  confirm();
})();
