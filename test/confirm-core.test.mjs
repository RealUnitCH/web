import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Importing the classic script runs it against the jsdom window and exposes the
// helpers + copy on window.RealUnitConfirm without any side effects.
import '../public/js/lib/confirm-core.js';

const core = window.RealUnitConfirm;
const {
  SUPPORTED_LANGS,
  I18N,
  resolveLang,
  isRealUnitHost,
  apiBase,
  hasRequiredParams,
  buildConfirmUrl,
  mapResult,
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

describe('resolveLang', () => {
  test('prefers a supported ?lang= over the browser language', () => {
    expect(resolve({ urlLang: 'en', navigatorLang: 'de-DE' })).toBe('en');
  });

  test('normalizes a region-tagged ?lang= (EN-us → en)', () => {
    expect(resolve({ urlLang: 'EN-us' })).toBe('en');
  });

  test('a present but unsupported ?lang= falls back to the default (browser not consulted)', () => {
    expect(resolve({ urlLang: 'pt', navigatorLang: 'en-US' })).toBe('de');
  });

  test('uses the browser language when there is no ?lang=', () => {
    expect(resolve({ navigatorLang: 'en-GB' })).toBe('en');
  });

  test('falls back to the explicit default for an unsupported browser language', () => {
    expect(resolve({ navigatorLang: 'fr-FR' })).toBe('de');
  });

  test('falls back to the default when both inputs are absent (null)', () => {
    expect(resolve({ urlLang: null, navigatorLang: null })).toBe('de');
  });

  test('treats a non-string value as absent', () => {
    expect(resolve({ urlLang: 123, navigatorLang: undefined })).toBe('de');
  });
});

describe('isRealUnitHost', () => {
  test('true for the production and dev hosts', () => {
    expect(isRealUnitHost('realunit.app')).toBe(true);
    expect(isRealUnitHost('www.realunit.app')).toBe(true);
    expect(isRealUnitHost('dev.realunit.app')).toBe(true);
  });

  test('false for any other host', () => {
    expect(isRealUnitHost('localhost')).toBe(false);
    expect(isRealUnitHost('127.0.0.1')).toBe(false);
  });
});

describe('apiBase', () => {
  test('production hosts map to the production API', () => {
    expect(apiBase({ host: 'realunit.app' })).toBe('https://api.dfx.swiss');
    expect(apiBase({ host: 'www.realunit.app' })).toBe('https://api.dfx.swiss');
  });

  test('the dev host maps to the dev API', () => {
    expect(apiBase({ host: 'dev.realunit.app' })).toBe('https://dev.api.dfx.swiss');
  });

  test('an unknown host uses an explicit ?api= override when present', () => {
    expect(apiBase({ host: 'localhost', paramApi: 'https://api.example.test' })).toBe(
      'https://api.example.test',
    );
  });

  test('an unknown host without an override falls back to the dev API', () => {
    expect(apiBase({ host: 'localhost', paramApi: null })).toBe('https://dev.api.dfx.swiss');
  });
});

describe('hasRequiredParams', () => {
  test('true only when email, code and user are all present', () => {
    expect(hasRequiredParams({ email: 'a', code: 'b', user: 'c' })).toBe(true);
  });

  test('false when any field is missing or empty', () => {
    expect(hasRequiredParams({ email: '', code: 'b', user: 'c' })).toBe(false);
    expect(hasRequiredParams({ email: 'a', code: '', user: 'c' })).toBe(false);
    expect(hasRequiredParams({ email: 'a', code: 'b', user: '' })).toBe(false);
    expect(hasRequiredParams({ email: null, code: null, user: null })).toBe(false);
  });
});

describe('buildConfirmUrl', () => {
  test('appends the endpoint and encodes each param', () => {
    expect(
      buildConfirmUrl('https://dev.api.dfx.swiss', { email: 'a@b.ch', code: 'x y', user: 'u/1' }),
    ).toBe(
      'https://dev.api.dfx.swiss/v1/realunit/confirm-aktionariat?email=a%40b.ch&code=x%20y&user=u%2F1',
    );
  });

  test('lower-cases the email before encoding', () => {
    expect(
      buildConfirmUrl('https://dev.api.dfx.swiss', {
        email: 'Mixed.Case@Example.COM',
        code: 'C',
        user: 'U',
      }),
    ).toContain('email=mixed.case%40example.com');
  });

  test('leaves the opaque code and user tokens case-sensitive', () => {
    const url = buildConfirmUrl('https://x', { email: 'A@B.CH', code: 'AbC1', user: 'Uu-9' });
    expect(url).toContain('code=AbC1');
    expect(url).toContain('user=Uu-9');
    expect(url).not.toContain('B.CH');
  });

  test('forwards every other mail-link param verbatim (URL-encoded) after email/code/user', () => {
    const url = buildConfirmUrl('https://x', {
      email: 'A@B.CH',
      code: 'C',
      user: 'U',
      address: '0xAbC',
      ref: 'a b',
    });
    // the three modelled params keep their exact prefix and normalisation
    expect(url).toContain('email=a%40b.ch');
    expect(url).toContain('code=C');
    expect(url).toContain('user=U');
    // any extra param the link carries reaches the API, encoded
    expect(url).toContain('address=0xAbC');
    expect(url).toContain('ref=a%20b');
  });

  test('strips the web-only control params (api, mock) but still forwards genuine link params like lang', () => {
    const url = buildConfirmUrl('https://x', {
      email: 'a@b.ch',
      code: 'C',
      user: 'U',
      api: 'https://evil.example',
      mock: 'confirmed',
      lang: 'en',
    });
    expect(url).not.toContain('api=');
    expect(url).not.toContain('mock=');
    expect(url).toContain('lang=en');
  });
});

describe('mapResult', () => {
  test('any non-2xx response maps to unavailable', () => {
    expect(mapResult({ ok: false, body: { status: 'confirmed' } })).toBe('unavailable');
  });

  test('a 2xx response passes through a known status', () => {
    expect(mapResult({ ok: true, body: { status: 'confirmed' } })).toBe('confirmed');
    expect(mapResult({ ok: true, body: { status: 'invalid' } })).toBe('invalid');
    expect(mapResult({ ok: true, body: { status: 'unavailable' } })).toBe('unavailable');
  });

  test('a 2xx response with status confirmed_no_registration maps to no-registration', () => {
    expect(mapResult({ ok: true, body: { status: 'confirmed_no_registration' } })).toBe(
      'no-registration',
    );
  });

  test('a 2xx response with an unrecognized status maps to unavailable', () => {
    expect(mapResult({ ok: true, body: { status: 'weird' } })).toBe('unavailable');
  });

  test('a 2xx response with no body maps to unavailable', () => {
    expect(mapResult({ ok: true, body: null })).toBe('unavailable');
  });
});

describe('i18n copy', () => {
  test('de and en carry the exact same keys', () => {
    expect(Object.keys(I18N.en).sort()).toEqual(Object.keys(I18N.de).sort());
  });

  test('every data-i18n* key used in the confirm page exists in both languages', () => {
    const html = readFileSync('public/confirm-aktionariat/index.html', 'utf8');
    const keys = new Set();
    for (const match of html.matchAll(/data-i18n(?:-alt|-aria)?=["']([^"']+)["']/g)) {
      keys.add(match[1]);
    }
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(I18N.de).toHaveProperty([key]);
      expect(I18N.en).toHaveProperty([key]);
    }
  });
});
