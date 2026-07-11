/* DOM + network glue for the Aktionariat address-confirmation page. The pure,
   testable logic (language resolution, host/API-base derivation, response → state
   mapping, event URL/body construction, and the i18n copy) lives in
   js/lib/confirm-core.js, loaded before this file; everything here touches the
   DOM/network and is covered by the Playwright functional suite. */
(function () {
  'use strict';

  var core = window.RealUnitConfirm;
  var params = new URLSearchParams(window.location.search);
  var host = window.location.hostname;

  // Link params, read once. Any may be null (absent from the link).
  var email = params.get('email');
  var code = params.get('code');
  var user = params.get('user');

  // The DFX API base for this host (production fixed, else ?api= override / DEV).
  // Shared by the confirm GET and the durable-logging POST; both hit this host,
  // already allowed by the page CSP's connect-src.
  var base = core.apiBase({ host: host, paramApi: params.get('api') });

  var lang = core.resolveLang({
    urlLang: params.get('lang'),
    navigatorLang: navigator.language,
    supported: core.SUPPORTED_LANGS,
    defaultLang: 'de',
  });
  document.documentElement.lang = lang;
  var t = core.I18N[lang];

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

  // The return-to-app hand-off uses a fixed custom URL scheme,
  // realunit-wallet://open, hard-coded on the button in the markup — no host
  // derivation needed. realunit.app claims no Universal/App Link, so the
  // confirmation email always reaches this web page; the app registers the scheme
  // to re-open itself after confirmation.

  // Fire-and-forget durable logging of each confirm lifecycle stage to the DFX
  // API. Best-effort only: it never blocks or alters the UX, a short timeout
  // keeps it from lingering, keepalive lets an in-flight event survive the
  // navigation the "Zurück zur App" button triggers, and every failure is
  // swallowed. The pure URL/body construction is unit-tested in confirm-core.js.
  function logEvent(phase, detail) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 5000);
    var settled = function () {
      clearTimeout(timeoutId);
    };
    try {
      fetch(core.buildEventUrl(base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          core.buildEventBody(phase, { email: email, code: code, user: user }, detail),
        ),
        keepalive: true,
        signal: controller.signal,
      })
        .then(settled)
        .catch(settled);
    } catch (_e) {
      // fetch() itself never throws in practice, but stay defensive: logging must
      // never surface an error to the confirmation flow.
      settled();
    }
  }

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

  // API state → durable-logging phase for the mapped confirm result.
  var RESULT_PHASE = {
    confirmed: 'resultConfirmed',
    invalid: 'resultInvalid',
    unavailable: 'resultUnavailable',
  };

  function confirm() {
    show('loading');

    // Mock hook for LOCAL preview only (?mock=confirmed|invalid|unavailable).
    // Never honored on the real realunit.app / dev.realunit.app hosts, so a
    // shared prod link cannot render a spoofed confirmation screen. A mock render
    // is a pure local visual preview and emits no durable-logging events, so it
    // never writes fabricated outcomes to the diagnostic log.
    var mock = params.get('mock');
    if (mock && !core.isRealUnitHost(host)) {
      setTimeout(function () {
        render(mock);
      }, 400);
      return;
    }

    logEvent('pageLoaded');

    if (!core.hasRequiredParams({ email: email, code: code, user: user })) {
      logEvent('missingParams');
      show('invalid');
      return;
    }

    var url = core.buildConfirmUrl(base, { email: email, code: code, user: user });
    logEvent('requestSent');

    // Abort a stalled request so the spinner can never hang forever.
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 15000);

    fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
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
        var state = core.mapResult(r);
        logEvent(RESULT_PHASE[state]);
        render(state);
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        // network error / timeout (abort) → retryable
        logEvent('requestError', err && err.name === 'AbortError' ? 'timeout' : 'network');
        render('unavailable');
      });
  }

  document.getElementById('retry').addEventListener('click', confirm);
  confirm();
})();
