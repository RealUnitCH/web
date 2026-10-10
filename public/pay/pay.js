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

  var drawnPlaces = null;

  function mapShape(fit, rings, fill, stroke, strokeWidth) {
    var ns = 'http://www.w3.org/2000/svg';
    var path = document.createElementNS(ns, 'path');
    var commands = '';
    for (var r = 0; r < rings.length; r += 1) {
      var ring = rings[r];
      for (var i = 0; i < ring.length; i += 1) {
        var point = core.projectPoint(ring[i][0], ring[i][1], fit);
        commands +=
          (i === 0 ? 'M' : 'L') +
          (point.x * fit.width).toFixed(2) +
          ' ' +
          (point.y * fit.height).toFixed(2);
      }
      commands += 'Z';
    }
    path.setAttribute('d', commands);
    path.setAttribute('fill', fill);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', strokeWidth);
    path.setAttribute('stroke-linejoin', 'round');
    return path;
  }

  function drawBaseMap(map, fit) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    var geometry = window.RealUnitPayMap;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('viewBox', '0 0 ' + fit.width + ' ' + fit.height);
    if (!geometry) return svg;
    svg.appendChild(mapShape(fit, geometry.country, '#ffffff', '#475569', '1.2'));
    svg.appendChild(mapShape(fit, geometry.lakes, '#D1E6F5', '#1988C6', '0.8'));
    return svg;
  }

  function render(places, openFirst) {
    drawnPlaces = places;
    var map = document.getElementById('pay-map');
    if (!places || !places.length) {
      drawnPlaces = null;
      map.replaceChildren();
      show('empty');
      return;
    }
    show('places');
    var selected = map.querySelector('.pin.is-selected');
    var selectedName = selected ? selected.getAttribute('aria-label') : '';
    var fit = core.mapFit(map.clientWidth, map.clientHeight);
    var framed = core.framePlaces(places, fit.width, fit.height);
    map.replaceChildren(drawBaseMap(map, fit));
    framed.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pin';
      button.style.left = (item.x * 100).toFixed(4) + '%';
      button.style.top = (item.y * 100).toFixed(4) + '%';
      button.setAttribute('aria-label', item.place.name);
      if (item.place.name === selectedName) button.classList.add('is-selected');
      button.addEventListener('click', function () {
        var pins = map.querySelectorAll('.pin');
        for (var i = 0; i < pins.length; i += 1) pins[i].classList.remove('is-selected');
        button.classList.add('is-selected');
        openPopup(item.place);
      });
      map.appendChild(button);
      if (openFirst && item.place === places[0]) button.click();
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
    var pins = document.querySelectorAll('#pay-map .pin');
    for (var i = 0; i < pins.length; i += 1) pins[i].classList.remove('is-selected');
  });
  window.addEventListener('resize', function () {
    if (drawnPlaces && drawnPlaces.length) render(drawnPlaces, false);
  });
  document.getElementById('pay-retry').addEventListener('click', load);
  load();
})();
