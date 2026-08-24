/* DOM + network glue for the personal invite / promo landing page. The pure,
   testable logic (language resolution, host/API-base derivation, path→code,
   response → state mapping, store/app URLs, and the i18n copy) lives in
   js/lib/invite-core.js, loaded before this file; everything here touches the
   DOM/network and is covered by the Playwright functional suite. */
(function () {
  'use strict';

  var core = window.RealUnitInvite;
  var params = new URLSearchParams(window.location.search);
  var host = window.location.hostname;
  var pathname = window.location.pathname;

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

  var STATES = ['loading', 'invite', 'promo', 'invalid', 'unavailable'];

  function show(state) {
    STATES.forEach(function (s) {
      document.getElementById('state-' + s).hidden = s !== state;
    });
    // Expose the active state for tests / tooling (same pattern as waitFor views).
    document.documentElement.dataset.state = state;
  }

  function setOpenAppHref(code) {
    var href = core.appSchemeUrl(code);
    document.querySelectorAll('[data-open-app]').forEach(function (el) {
      el.setAttribute('href', href);
    });
  }

  function setStoreHrefs(code) {
    document.querySelectorAll('a[data-store="apple"]').forEach(function (el) {
      el.setAttribute('href', core.appStoreUrl());
    });
    document.querySelectorAll('a[data-store="play"]').forEach(function (el) {
      el.setAttribute('href', core.playStoreUrl(code));
    });
  }

  function applyInviteCopy(body) {
    var greeting = core.formatInviteGreeting(
      lang,
      body && body.guestName,
      body && body.hostDisplayName,
    );
    document.querySelectorAll('[data-invite-body]').forEach(function (el) {
      el.textContent = greeting;
    });
  }

  function applyPromoCopy(body) {
    var text = core.formatPromoBody(lang, body || {});
    document.querySelectorAll('[data-promo-body]').forEach(function (el) {
      el.textContent = text;
    });
  }

  function render(state, body, code) {
    if (state === 'invite') {
      applyInviteCopy(body);
      setStoreHrefs(code);
      setOpenAppHref(code);
      show('invite');
    } else if (state === 'promo') {
      applyPromoCopy(body);
      setStoreHrefs(code);
      setOpenAppHref(code);
      show('promo');
    } else if (state === 'invalid') {
      show('invalid');
    } else {
      show('unavailable');
    }
  }

  function load() {
    show('loading');

    // Mock hook for LOCAL preview only (?mock=invite|promo|invalid|unavailable).
    // Never honored on the real realunit.app / dev.realunit.app hosts, so a
    // shared prod link cannot render a spoofed landing screen.
    var mock = params.get('mock');
    if (mock && !core.isRealUnitHost(host)) {
      setTimeout(function () {
        var demoCode = core.extractCode(pathname) || 'MOCKINVITECODE01';
        if (mock === 'invite') {
          render('invite', { guestName: 'Alex', hostDisplayName: 'Sam' }, demoCode);
        } else if (mock === 'promo') {
          render(
            'promo',
            {
              campaignText: 'Starte mit RealUnit und sichere dir den Bonus.',
              campaignTextEn: 'Get started with RealUnit and claim your bonus.',
            },
            demoCode,
          );
        } else if (mock === 'invalid') {
          render('invalid');
        } else {
          render('unavailable');
        }
      }, 400);
      return;
    }

    var code = core.extractCode(pathname);
    if (!code) {
      // No code in the path → invalid without fetching.
      render('invalid');
      return;
    }

    var url = core.buildLandingUrl(core.apiBase({ host: host, paramApi: params.get('api') }), code);

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
            return { status: res.status, body: body };
          })
          .catch(function () {
            return { status: res.status, body: {} };
          });
      })
      .then(function (r) {
        clearTimeout(timeoutId);
        render(core.mapLandingResponse(r), r.body, code);
      })
      .catch(function () {
        clearTimeout(timeoutId);
        render('unavailable'); // network error / timeout (abort) → retryable
      });
  }

  document.getElementById('retry').addEventListener('click', load);
  load();
})();
