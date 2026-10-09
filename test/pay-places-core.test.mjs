import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import '../public/js/lib/pay-places-core.js';

const core = window.RealUnitPlaces;
const {
  SUPPORTED_LANGS,
  I18N,
  PLACES_URL,
  resolveLang,
  isRealUnitHost,
  previewMock,
  keepPlace,
  keepPlaces,
  framePlaces,
  previewPlaces,
  placesFetchInit,
} = core;

function resolve(overrides) {
  return resolveLang({
    urlLang: null,
    navigatorLang: null,
    supported: SUPPORTED_LANGS,
    defaultLang: 'de',
    ...overrides,
  });
}

function place(overrides) {
  return {
    name: 'Zürich',
    category: 'Lebensmittel',
    lat: 47.37,
    lon: 8.54,
    supports: [{ blockchain: 'Ethereum', asset: 'ZCHF' }],
    ...overrides,
  };
}

describe('placesFetchInit', () => {
  test('is GET with credentials omit, and keeps a signal when one is passed', () => {
    expect(placesFetchInit()).toEqual({ method: 'GET', credentials: 'omit' });
    const signal = { aborted: false };
    expect(placesFetchInit(signal)).toEqual({
      method: 'GET',
      credentials: 'omit',
      signal,
    });
  });
});

describe('resolveLang', () => {
  test('prefers a supported document language over the browser', () => {
    expect(resolve({ urlLang: 'en', navigatorLang: 'de-DE' })).toBe('en');
  });

  test('normalizes a region tag', () => {
    expect(resolve({ urlLang: 'EN-us' })).toBe('en');
  });

  test('an unsupported document language falls back without asking the browser', () => {
    expect(resolve({ urlLang: 'pt', navigatorLang: 'en-US' })).toBe('de');
  });

  test('uses the browser language when the document language is absent', () => {
    expect(resolve({ navigatorLang: 'en-GB' })).toBe('en');
  });

  test('an empty document language falls through to the browser', () => {
    expect(resolve({ urlLang: '', navigatorLang: 'en' })).toBe('en');
  });

  test('falls back when the browser language is unsupported', () => {
    expect(resolve({ navigatorLang: 'fr-FR' })).toBe('de');
  });

  test('falls back when both inputs are absent', () => {
    expect(resolve({ urlLang: null, navigatorLang: null })).toBe('de');
  });

  test('treats a non-string value as absent', () => {
    expect(resolve({ urlLang: 123, navigatorLang: undefined })).toBe('de');
  });
});

describe('isRealUnitHost', () => {
  test('true only for the real and dev hosts', () => {
    expect(isRealUnitHost('realunit.app')).toBe(true);
    expect(isRealUnitHost('www.realunit.app')).toBe(true);
    expect(isRealUnitHost('dev.realunit.app')).toBe(true);
    expect(isRealUnitHost('localhost')).toBe(false);
    expect(isRealUnitHost('127.0.0.1')).toBe(false);
  });
});

describe('previewMock', () => {
  test('refuses every mock on a real host', () => {
    for (const host of ['realunit.app', 'www.realunit.app', 'dev.realunit.app']) {
      expect(previewMock(host, 'places')).toBeNull();
    }
  });

  test('accepts the known mocks on a preview host', () => {
    for (const mock of ['loading', 'error', 'empty', 'places', 'place']) {
      expect(previewMock('localhost', mock)).toBe(mock);
    }
  });

  test('rejects an unknown or empty mock', () => {
    expect(previewMock('localhost', 'nope')).toBeNull();
    expect(previewMock('localhost', '')).toBeNull();
    expect(previewMock('localhost', null)).toBeNull();
  });
});

describe('keepPlace', () => {
  test('keeps an exact Ethereum and ZCHF pair and trims the name', () => {
    expect(keepPlace(place({ name: '  Zürich  ', category: '  Café  ' }))).toEqual({
      name: 'Zürich',
      category: 'Café',
      lat: 47.37,
      lon: 8.54,
    });
  });

  test('keeps a match that sits beside another pair', () => {
    const kept = keepPlace(
      place({
        supports: [
          null,
          { blockchain: 'Lightning', asset: 'BTC' },
          { blockchain: 'Ethereum', asset: 'ZCHF' },
        ],
      }),
    );
    expect(kept?.name).toBe('Zürich');
  });

  test('accepts the coordinate limits', () => {
    expect(keepPlace(place({ lat: -90, lon: -180 }))?.name).toBe('Zürich');
    expect(keepPlace(place({ lat: 90, lon: 180 }))?.name).toBe('Zürich');
  });

  test('drops a place that is not an object', () => {
    expect(keepPlace(null)).toBeNull();
    expect(keepPlace('Zürich')).toBeNull();
  });

  test('drops coordinates that are not finite numbers inside range', () => {
    expect(keepPlace(place({ lat: '47.37' }))).toBeNull();
    expect(keepPlace(place({ lat: Number.NaN }))).toBeNull();
    expect(keepPlace(place({ lat: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(keepPlace(place({ lon: Number.NEGATIVE_INFINITY }))).toBeNull();
    expect(keepPlace(place({ lat: -90.0001 }))).toBeNull();
    expect(keepPlace(place({ lon: 180.0001 }))).toBeNull();
    expect(keepPlace(place({ lat: 47.37, lon: undefined }))).toBeNull();
  });

  test('drops a missing, empty, or non-array support list', () => {
    expect(keepPlace(place({ supports: undefined }))).toBeNull();
    expect(keepPlace(place({ supports: null }))).toBeNull();
    expect(keepPlace(place({ supports: {} }))).toBeNull();
    expect(keepPlace(place({ supports: [] }))).toBeNull();
  });

  test('drops the wrong chain, the wrong asset, and the wrong case', () => {
    expect(keepPlace(place({ supports: [{ blockchain: 'ethereum', asset: 'ZCHF' }] }))).toBeNull();
    expect(keepPlace(place({ supports: [{ blockchain: 'Ethereum', asset: 'zchf' }] }))).toBeNull();
    expect(keepPlace(place({ supports: [{ blockchain: 'Ethereum' }] }))).toBeNull();
    expect(keepPlace(place({ supports: ['Ethereum'] }))).toBeNull();
  });

  test('drops a blank or non-string name and a blank category becomes empty', () => {
    expect(keepPlace(place({ name: '   ' }))).toBeNull();
    expect(keepPlace(place({ name: 12 }))).toBeNull();
    expect(keepPlace(place({ name: undefined }))).toBeNull();
    expect(keepPlace(place({ category: '   ' }))?.category).toBe('');
    expect(keepPlace(place({ category: null }))?.category).toBe('');
  });
});

describe('keepPlaces', () => {
  test('returns null when the body is not a place list', () => {
    expect(keepPlaces(null)).toBeNull();
    expect(keepPlaces('places')).toBeNull();
    expect(keepPlaces([])).toBeNull();
    expect(keepPlaces({})).toBeNull();
    expect(keepPlaces({ places: null })).toBeNull();
    expect(keepPlaces({ places: {} })).toBeNull();
  });

  test('returns the kept pins and drops the rest', () => {
    expect(keepPlaces({ places: [] })).toEqual([]);
    expect(
      keepPlaces({
        places: [null, place({ name: 'Bern' }), place({ supports: [] })],
      }),
    ).toEqual([{ name: 'Bern', category: 'Lebensmittel', lat: 47.37, lon: 8.54 }]);
  });
});

describe('framePlaces', () => {
  test('an empty or missing list has no frame', () => {
    expect(framePlaces(null)).toEqual([]);
    expect(framePlaces([])).toEqual([]);
  });

  test('one pin sits in the middle', () => {
    const only = { name: 'Bern', category: '', lat: 46.9, lon: 7.4 };
    expect(framePlaces([only])).toEqual([{ place: only, x: 0.5, y: 0.5 }]);
  });

  test('several pins keep north up and stay inside the padding', () => {
    const framed = framePlaces([
      { name: 'A', lat: 47, lon: 8 },
      { name: 'B', lat: 46, lon: 7 },
      { name: 'C', lat: 48, lon: 9 },
    ]);
    expect(framed.map((item) => item.place.name)).toEqual(['A', 'B', 'C']);
    expect(framed[0].x).toBeCloseTo(0.5);
    expect(framed[0].y).toBeCloseTo(0.5);
    expect(framed[1].x).toBeCloseTo(0.12);
    expect(framed[1].y).toBeCloseTo(0.88);
    expect(framed[2].x).toBeCloseTo(0.88);
    expect(framed[2].y).toBeCloseTo(0.12);
  });

  test('a shared longitude does not divide by zero', () => {
    const framed = framePlaces([
      { name: 'N', lat: 47, lon: 8 },
      { name: 'S', lat: 46, lon: 8 },
    ]);
    expect(framed[0].x).toBeCloseTo(0.12);
    expect(framed[1].x).toBeCloseTo(0.12);
    expect(framed[0].y).toBeCloseTo(0.12);
    expect(framed[1].y).toBeCloseTo(0.88);
  });

  test('a shared latitude does not divide by zero', () => {
    const framed = framePlaces([
      { name: 'W', lat: 47, lon: 7 },
      { name: 'E', lat: 47, lon: 9 },
    ]);
    expect(framed[0].y).toBeCloseTo(0.12);
    expect(framed[1].y).toBeCloseTo(0.12);
    expect(framed[0].x).toBeCloseTo(0.12);
    expect(framed[1].x).toBeCloseTo(0.88);
  });

  test('identical pins share one point', () => {
    const framed = framePlaces([
      { name: 'A', lat: 47, lon: 8 },
      { name: 'B', lat: 47, lon: 8 },
    ]);
    expect(framed[0].x).toBeCloseTo(0.12);
    expect(framed[0].y).toBeCloseTo(0.12);
    expect(framed[1]).toMatchObject({ x: framed[0].x, y: framed[0].y });
  });
});

describe('previewPlaces', () => {
  test('places and place share three named preview shops', () => {
    for (const mock of ['places', 'place']) {
      const pins = previewPlaces(mock);
      expect(pins.map((pin) => pin.name)).toEqual(['Zürich', 'Bern', 'Lugano']);
    }
  });

  test('any other mock is an empty list', () => {
    expect(previewPlaces('empty')).toEqual([]);
    expect(previewPlaces('loading')).toEqual([]);
    expect(previewPlaces(null)).toEqual([]);
  });
});

describe('place list address', () => {
  test('asks only for Ethereum and ZCHF', () => {
    expect(PLACES_URL).toBe(
      'https://api.opencryptopay.io/map/places?blockchain=Ethereum&asset=ZCHF',
    );
  });
});

describe('i18n copy', () => {
  test('de and en carry the same keys', () => {
    expect(Object.keys(I18N.en).sort()).toEqual(Object.keys(I18N.de).sort());
  });

  test('every data-i18n key on both pages exists in both languages', () => {
    const keys = new Set(['doc.title', 'doc.desc']);
    for (const file of ['public/pay/index.html', 'public/pay/en/index.html']) {
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(/data-i18n(?:-aria)?=["']([^"']+)["']/g)) {
        keys.add(match[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(8);
    for (const key of keys) {
      expect(I18N.de[key], key).toBeTruthy();
      expect(I18N.en[key], key).toBeTruthy();
    }
  });
});
