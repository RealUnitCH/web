import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Importing the classic script runs it against the jsdom window and exposes the
// helpers + copy on window.RealUnitInvite without any side effects.
import '../public/js/lib/invite-core.js';

const core = window.RealUnitInvite;
const {
  SUPPORTED_LANGS,
  I18N,
  resolveLang,
  isRealUnitHost,
  apiBase,
  extractCode,
  buildLandingUrl,
  mapLandingResponse,
  formatInviteGreeting,
  formatPromoBody,
  playStoreUrl,
  appStoreUrl,
  appSchemeUrl,
  universalLinkUrl,
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

describe('extractCode', () => {
  test('returns the last non-empty segment after /invite/', () => {
    expect(extractCode('/invite/AbCdEfGhIjKlMnOp')).toBe('AbCdEfGhIjKlMnOp');
    expect(extractCode('/invite/AbCdEfGhIjKlMnOp/')).toBe('AbCdEfGhIjKlMnOp');
  });

  test('returns empty when there is no code segment', () => {
    expect(extractCode('/invite/')).toBe('');
    expect(extractCode('/invite')).toBe('');
    expect(extractCode('/')).toBe('');
  });

  test('ignores non-invite paths and non-string input', () => {
    expect(extractCode('/confirm-aktionariat/')).toBe('');
    expect(extractCode('')).toBe('');
    expect(extractCode(null)).toBe('');
    expect(extractCode(undefined)).toBe('');
  });

  test('uses the last segment when more than one follows invite', () => {
    expect(extractCode('/invite/foo/bar')).toBe('bar');
  });
});

describe('buildLandingUrl', () => {
  test('appends the landing endpoint and encodes the code', () => {
    expect(buildLandingUrl('https://dev.api.dfx.swiss', 'Ab C')).toBe(
      'https://dev.api.dfx.swiss/v1/realunit/referral/landing/Ab%20C',
    );
  });
});

describe('mapLandingResponse', () => {
  test('404 maps to invalid', () => {
    expect(mapLandingResponse({ status: 404, body: {} })).toBe('invalid');
  });

  test('non-2xx (other than 404) maps to unavailable', () => {
    expect(mapLandingResponse({ status: 500, body: {} })).toBe('unavailable');
    expect(mapLandingResponse({ status: 503, body: {} })).toBe('unavailable');
    expect(mapLandingResponse({ status: 0, body: {} })).toBe('unavailable');
  });

  test('200 Invite maps to invite', () => {
    expect(mapLandingResponse({ status: 200, body: { kind: 'Invite' } })).toBe('invite');
  });

  test('200 Promo maps to promo', () => {
    expect(mapLandingResponse({ status: 200, body: { kind: 'Promo' } })).toBe('promo');
  });

  test('200 with an unrecognized kind maps to unavailable', () => {
    expect(mapLandingResponse({ status: 200, body: { kind: 'Other' } })).toBe('unavailable');
    expect(mapLandingResponse({ status: 200, body: {} })).toBe('unavailable');
    expect(mapLandingResponse({ status: 200, body: null })).toBe('unavailable');
  });

  test('a missing response object maps to unavailable', () => {
    expect(mapLandingResponse(null)).toBe('unavailable');
    expect(mapLandingResponse(undefined)).toBe('unavailable');
  });
});

describe('formatInviteGreeting', () => {
  test('fills German and English templates with the guest and host names', () => {
    expect(formatInviteGreeting('de', 'Alex', 'Sam')).toBe(
      'Hey Alex, Sam lädt dich ein zu RealUnit.',
    );
    expect(formatInviteGreeting('en', 'Alex', 'Sam')).toBe(
      'Hey Alex, Sam is inviting you to RealUnit.',
    );
  });

  test('treats missing names as empty strings and unknown lang as German', () => {
    expect(formatInviteGreeting('de', null, undefined)).toBe('Hey ,  lädt dich ein zu RealUnit.');
    expect(formatInviteGreeting('fr', 'A', 'B')).toBe('Hey A, B lädt dich ein zu RealUnit.');
  });
});

describe('formatPromoBody', () => {
  test('German uses campaignText', () => {
    expect(formatPromoBody('de', { campaignText: 'DE text', campaignTextEn: 'EN text' })).toBe(
      'DE text',
    );
  });

  test('English prefers campaignTextEn and falls back to German', () => {
    expect(formatPromoBody('en', { campaignText: 'DE text', campaignTextEn: 'EN text' })).toBe(
      'EN text',
    );
    expect(formatPromoBody('en', { campaignText: 'DE only' })).toBe('DE only');
  });

  test('missing body fields yield an empty string', () => {
    expect(formatPromoBody('de', {})).toBe('');
    expect(formatPromoBody('en', null)).toBe('');
  });
});

describe('store and app URLs', () => {
  test('playStoreUrl appends an invite referrer when a code is present', () => {
    expect(playStoreUrl('AbCdEfGhIjKlMnOp')).toBe(
      'https://play.google.com/store/apps/details?id=swiss.realunit.app&referrer=invite%3DAbCdEfGhIjKlMnOp',
    );
  });

  test('playStoreUrl without a code is the plain store URL', () => {
    expect(playStoreUrl('')).toBe(
      'https://play.google.com/store/apps/details?id=swiss.realunit.app',
    );
    expect(playStoreUrl(null)).toBe(
      'https://play.google.com/store/apps/details?id=swiss.realunit.app',
    );
  });

  test('appStoreUrl is the fixed App Store listing', () => {
    expect(appStoreUrl()).toBe('https://apps.apple.com/ch/app/realunit/id6759720010');
  });

  test('appSchemeUrl uses the invite path when a code is present', () => {
    expect(appSchemeUrl('CODE123456789012')).toBe('realunit-wallet://invite/CODE123456789012');
    expect(appSchemeUrl('')).toBe('realunit-wallet://open');
    expect(appSchemeUrl(null)).toBe('realunit-wallet://open');
  });

  test('universalLinkUrl builds the https self-link', () => {
    expect(universalLinkUrl('CODE123456789012')).toBe(
      'https://realunit.app/invite/CODE123456789012',
    );
    expect(universalLinkUrl('')).toBe('https://realunit.app/invite/');
    expect(universalLinkUrl(null)).toBe('https://realunit.app/invite/');
  });
});

describe('i18n copy', () => {
  test('de and en carry the exact same keys', () => {
    expect(Object.keys(I18N.en).sort()).toEqual(Object.keys(I18N.de).sort());
  });

  test('every data-i18n* key used in the invite page exists in both languages', () => {
    const html = readFileSync('public/invite/index.html', 'utf8');
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
