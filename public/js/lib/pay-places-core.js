/**
 * Pure helpers and copy for the pay-locations page (public/pay/).
 *
 * Loaded as a classic script before public/pay/pay.js. No DOM and no network,
 * so the unit suite can cover every branch. The page glue owns fetch and pins.
 */
(function (global) {
  'use strict';

  var SUPPORTED_LANGS = ['de', 'en'];
  var REALUNIT_HOSTS = ['realunit.app', 'www.realunit.app', 'dev.realunit.app'];
  var PLACES_URL = 'https://api.opencryptopay.io/map/places?blockchain=Ethereum&asset=ZCHF';
  var BLOCKCHAIN = 'Ethereum';
  var ASSET = 'ZCHF';

  var I18N = {
    de: {
      'doc.title': 'RealUnit — Zahlungsorte',
      'doc.desc': 'Geschäfte, in denen Sie mit der RealUnit Wallet bezahlen können.',
      'loading.title': 'Zahlungsorte werden geladen…',
      'loading.body': 'Einen Moment, wir laden die veröffentlichten Geschäfte.',
      'error.title': 'Zahlungsorte gerade nicht erreichbar',
      'error.body': 'Die Liste konnte nicht geladen werden. Bitte versuchen Sie es später erneut.',
      'error.cta': 'Erneut versuchen',
      'empty.title': 'Noch keine Zahlungsorte veröffentlicht',
      'empty.body':
        'Sobald Geschäfte RealUnit als Zahlungsweg veröffentlichen, erscheinen sie hier.',
      'places.title': 'Mit der RealUnit Wallet bezahlen',
      'places.body':
        'Die Punkte zeigen die veröffentlichten Geschäfte zueinander. Der Name steht beim ausgewählten Punkt.',
      'places.means':
        'Sie bezahlen nicht mit Ihren Aktien. Für jede Zahlung verkaufen Sie REALU. Den Erlös abzüglich der Gebühr erhalten Sie in ZCHF, einem Stablecoin in Schweizer Franken, und mit diesem ZCHF wird bezahlt. Da nur ganze Aktien verkauft werden, wird auf ganze REALU aufgerundet. Der Aufrundungsbetrag wird Ihnen nicht gutgeschrieben und fällt bei kleinen Beträgen stärker ins Gewicht.',
      'map.label': 'Veröffentlichte Zahlungsorte',
      'popup.close': 'Schliessen',
    },
    en: {
      'doc.title': 'RealUnit — Pay locations',
      'doc.desc': 'Shops where you can pay with the RealUnit Wallet.',
      'loading.title': 'Loading pay locations…',
      'loading.body': 'One moment — we’re loading the published shops.',
      'error.title': 'Pay locations are unavailable',
      'error.body': 'The list could not be loaded. Please try again later.',
      'error.cta': 'Try again',
      'empty.title': 'No pay locations published yet',
      'empty.body': 'Shops appear here once they publish RealUnit as a way to pay.',
      'places.title': 'Pay with the RealUnit Wallet',
      'places.body':
        'The points show the published shops relative to each other. The name appears for the selected point.',
      'places.means':
        'You do not pay with your shares. For each payment you sell REALU. You receive the proceeds minus the fee in ZCHF, a Swiss-franc stablecoin, and that ZCHF is what pays. Because only whole shares are sold, the sale is rounded up to whole REALU. The round-up amount is not credited to you and weighs more heavily on small amounts.',
      'map.label': 'Published pay locations',
      'popup.close': 'Close',
    },
  };

  function normalizeLang(value) {
    if (typeof value !== 'string') return '';
    return value.slice(0, 2).toLowerCase();
  }

  function resolveLang(options) {
    var supported = options.supported;
    var fromUrl = normalizeLang(options.urlLang);
    if (fromUrl) {
      return supported.indexOf(fromUrl) !== -1 ? fromUrl : options.defaultLang;
    }
    var fromNavigator = normalizeLang(options.navigatorLang);
    if (supported.indexOf(fromNavigator) !== -1) return fromNavigator;
    return options.defaultLang;
  }

  function isRealUnitHost(host) {
    return REALUNIT_HOSTS.indexOf(host) !== -1;
  }

  // Local preview only. A shared realunit.app link cannot force a fixture.
  function previewMock(host, value) {
    if (isRealUnitHost(host)) return null;
    if (
      value === 'loading' ||
      value === 'error' ||
      value === 'empty' ||
      value === 'places' ||
      value === 'place'
    ) {
      return value;
    }
    return null;
  }

  function finiteCoord(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function supportMatches(item) {
    if (!item || typeof item !== 'object') return false;
    return item.blockchain === BLOCKCHAIN && item.asset === ASSET;
  }

  // A pin is kept only when it names a shop, sits on a real coordinate, and
  // lists Ethereum + ZCHF exactly. A missing list is not that pair.
  function keepPlace(place) {
    if (!place || typeof place !== 'object') return null;
    if (!finiteCoord(place.lat, -90, 90) || !finiteCoord(place.lon, -180, 180)) return null;
    var supports = place.supports;
    if (!Array.isArray(supports)) return null;
    var matched = false;
    for (var i = 0; i < supports.length; i += 1) {
      if (supportMatches(supports[i])) matched = true;
    }
    if (!matched) return null;
    var name = typeof place.name === 'string' ? place.name.trim() : '';
    if (!name) return null;
    var category = typeof place.category === 'string' ? place.category.trim() : '';
    return { name: name, category: category, lat: place.lat, lon: place.lon };
  }

  // null means the body is not a place list. An empty array means the list
  // was readable and nothing in it is a RealUnit pay location.
  function keepPlaces(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.places)) return null;
    var kept = [];
    for (var i = 0; i < body.places.length; i += 1) {
      var place = keepPlace(body.places[i]);
      if (place) kept.push(place);
    }
    return kept;
  }

  // Positions are fractions of the frame, north up. One pin sits in the
  // middle. Several pins keep their relative spread, with padding so a pin
  // is not clipped by the frame. A zero span does not divide by zero.
  function framePlaces(places) {
    if (!places || places.length === 0) return [];
    if (places.length === 1) return [{ place: places[0], x: 0.5, y: 0.5 }];
    var minLon = places[0].lon;
    var maxLon = places[0].lon;
    var minLat = places[0].lat;
    var maxLat = places[0].lat;
    for (var i = 1; i < places.length; i += 1) {
      if (places[i].lon < minLon) minLon = places[i].lon;
      if (places[i].lon > maxLon) maxLon = places[i].lon;
      if (places[i].lat < minLat) minLat = places[i].lat;
      if (places[i].lat > maxLat) maxLat = places[i].lat;
    }
    var lonSpan = maxLon - minLon;
    var latSpan = maxLat - minLat;
    if (lonSpan === 0) lonSpan = 1;
    if (latSpan === 0) latSpan = 1;
    var pad = 0.12;
    var scale = 0.76;
    var framed = [];
    for (var j = 0; j < places.length; j += 1) {
      framed.push({
        place: places[j],
        x: pad + ((places[j].lon - minLon) / lonSpan) * scale,
        y: pad + ((maxLat - places[j].lat) / latSpan) * scale,
      });
    }
    return framed;
  }

  function placesFetchInit(signal) {
    var init = {
      method: 'GET',
      credentials: 'omit',
    };
    if (signal) init.signal = signal;
    return init;
  }

  function previewPlaces(mock) {
    if (mock !== 'places' && mock !== 'place') return [];
    return [
      { name: 'Zürich', category: 'Lebensmittel', lat: 47.3769, lon: 8.5417 },
      { name: 'Bern', category: 'Café', lat: 46.948, lon: 7.4474 },
      { name: 'Lugano', category: 'Bäckerei', lat: 46.0037, lon: 8.9511 },
    ];
  }

  global.RealUnitPlaces = {
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    I18N: I18N,
    PLACES_URL: PLACES_URL,
    resolveLang: resolveLang,
    isRealUnitHost: isRealUnitHost,
    previewMock: previewMock,
    keepPlace: keepPlace,
    keepPlaces: keepPlaces,
    framePlaces: framePlaces,
    placesFetchInit: placesFetchInit,
    previewPlaces: previewPlaces,
  };
})(window);
