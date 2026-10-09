/* DOM and network glue for the pay-locations page. Language, the keep rules,
   and the copy live in js/lib/pay-places-core.js, loaded before this file. */
(function () {
  'use strict';

  var core = window.RealUnitPlaces;
  var params = new URLSearchParams(window.location.search);
  var host = window.location.hostname;
  var lang = core.resolveLang({
    urlLang: document.documentElement.lang,
    navigatorLang: null,
    supported: core.SUPPORTED_LANGS,
    defaultLang: 'de',
  });
  document.documentElement.lang = lang;
  var t = core.I18N[lang];

  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var v = t[el.getAttribute('data-i18n')];
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
    var v = t[el.getAttribute('data-i18n-aria')];
    if (v) el.setAttribute('aria-label', v);
  });
  if (t['doc.title']) document.title = t['doc.title'];
  var descEl = document.querySelector('meta[name="description"]');
  if (descEl && t['doc.desc']) descEl.setAttribute('content', t['doc.desc']);

  var STATES = ['loading', 'error', 'empty', 'places'];
  function show(state) {
    STATES.forEach(function (s) {
      document.getElementById('state-' + s).hidden = s !== state;
    });
  }

  function openPopup(place) {
    var popup = document.getElementById('pay-popup');
    var category = document.getElementById('pay-popup-category');
    document.getElementById('pay-popup-name').textContent = place.name;
    if (place.category) {
      category.hidden = false;
      category.textContent = place.category;
    } else {
      category.hidden = true;
      category.textContent = '';
    }
    popup.hidden = false;
  }

  function render(places, openFirst) {
    var framed = core.framePlaces(places);
    var map = document.getElementById('pay-map');
    document.getElementById('pay-popup').hidden = true;
    map.replaceChildren();
    if (!framed.length) {
      show('empty');
      return;
    }
    show('places');
    framed.forEach(function (item, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pin';
      button.style.left = item.x * 100 + '%';
      button.style.top = item.y * 100 + '%';
      button.setAttribute('aria-label', item.place.name);
      button.addEventListener('click', function () {
        openPopup(item.place);
      });
      map.appendChild(button);
      if (openFirst && index === 0) openPopup(item.place);
    });
  }

  var attempt = 0;
  var controller = null;
  var timeoutId = null;

  function load() {
    var current = ++attempt;
    if (controller) controller.abort();
    if (timeoutId) clearTimeout(timeoutId);
    controller = null;
    timeoutId = null;
    show('loading');

    var mock = core.previewMock(host, params.get('mock'));
    if (mock === 'loading') return;
    if (mock === 'error') {
      show('error');
      return;
    }
    if (mock === 'empty' || mock === 'places' || mock === 'place') {
      render(core.previewPlaces(mock), mock === 'place');
      return;
    }

    controller = new AbortController();
    timeoutId = setTimeout(function () {
      if (controller) controller.abort();
    }, 15000);
    fetch(core.PLACES_URL, core.placesFetchInit(controller.signal))
      .then(function (response) {
        if (!response.ok) throw new Error('status');
        return response.json();
      })
      .then(function (body) {
        if (current !== attempt) return;
        clearTimeout(timeoutId);
        var kept = core.keepPlaces(body);
        if (kept === null) throw new Error('body');
        render(kept, false);
      })
      .catch(function () {
        if (current !== attempt) return;
        clearTimeout(timeoutId);
        show('error');
      });
  }

  document.getElementById('pay-popup-close').addEventListener('click', function () {
    document.getElementById('pay-popup').hidden = true;
  });
  document.getElementById('pay-retry').addEventListener('click', load);
  load();
})();
