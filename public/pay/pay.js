/* DOM and network glue for the pay-locations page. Language, the keep rules,
   and the copy live in js/lib/pay-places-core.js, loaded before this file.
   The map is the same OpenFreeMap Liberty style the OpenCryptoPay place map
   uses: same-origin MapLibre, tiles from tiles.openfreemap.org. */
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
  var mapView = null;
  var markers = [];
  var frameToken = 0;

  function clearMarkers() {
    for (var i = 0; i < markers.length; i += 1) markers[i].remove();
    markers = [];
  }

  function frameMap(places) {
    if (places.length === 1) {
      mapView.jumpTo({ center: [places[0].lon, places[0].lat], zoom: 12 });
      return;
    }
    var bounds = new maplibregl.LngLatBounds();
    for (var i = 0; i < places.length; i += 1) {
      bounds.extend([places[i].lon, places[i].lat]);
    }
    mapView.fitBounds(bounds, { padding: 48, maxZoom: 12, animate: false });
  }

  function ensureMap(container) {
    if (mapView) return mapView;
    mapView = new maplibregl.Map({
      container: container,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [8.23, 46.8],
      zoom: 7,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      locale: core.mapControlLocale(t),
    });
    mapView.addControl(new maplibregl.NavigationControl(), 'top-right');
    return mapView;
  }

  function addPin(place, selected, open) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pay-pin';
    if (selected) button.classList.add('is-selected');
    button.setAttribute('aria-label', place.name);
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var pins = document.querySelectorAll('#pay-map .pay-pin');
      for (var i = 0; i < pins.length; i += 1) pins[i].classList.remove('is-selected');
      button.classList.add('is-selected');
      openPopup(place);
    });
    markers.push(
      new maplibregl.Marker({ element: button, anchor: 'center' })
        .setLngLat([place.lon, place.lat])
        .addTo(mapView),
    );
    if (open) button.click();
  }

  function render(places, openFirst) {
    var container = document.getElementById('pay-map');
    if (!places || !places.length) {
      drawnPlaces = null;
      frameToken += 1;
      clearMarkers();
      container.removeAttribute('data-map-ready');
      show('empty');
      return;
    }
    drawnPlaces = places;
    show('places');
    var map = ensureMap(container);
    var token = (frameToken += 1);
    var selected = container.querySelector('.pay-pin.is-selected');
    var selectedName = selected ? selected.getAttribute('aria-label') : '';
    container.removeAttribute('data-map-ready');

    function draw() {
      if (token !== frameToken) return;
      clearMarkers();
      map.resize();
      for (var i = 0; i < places.length; i += 1) {
        addPin(places[i], places[i].name === selectedName, openFirst && places[i] === places[0]);
      }
      frameMap(places);
      map.once('idle', function () {
        if (token !== frameToken) return;
        container.setAttribute('data-map-ready', 'true');
      });
      map.triggerRepaint();
    }

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
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
    var pins = document.querySelectorAll('#pay-map .pay-pin');
    for (var i = 0; i < pins.length; i += 1) pins[i].classList.remove('is-selected');
  });
  window.addEventListener('resize', function () {
    if (!mapView || !drawnPlaces || !drawnPlaces.length) return;
    mapView.resize();
    frameMap(drawnPlaces);
  });
  document.getElementById('pay-retry').addEventListener('click', load);
  load();
})();
