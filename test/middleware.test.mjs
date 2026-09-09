import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { onRequest } from '../functions/_middleware.js';

// The real files, not a hand-written stand-in. The status promotion keys on a
// marker that lives in the landing shells and must never appear in the site's
// 404 page; a synthetic fixture would keep passing after someone moved that
// marker, and production would answer 404 again with nothing going red.
// Resolved from the project root: vitest runs from there, and the jsdom
// environment does not give this module a usable import.meta.url.
const page = (name) => readFileSync(resolve('public', name), 'utf8');
const SHELL = page('invite/index.html');
const PROMO_SHELL = page('promo/index.html');
const NOT_FOUND_PAGE = page('404.html');

function context({
  url,
  method = 'GET',
  status = 404,
  body = SHELL,
  type = 'text/html; charset=utf-8',
}) {
  const headers = new Headers({ 'content-type': type, 'content-length': String(body.length) });
  const next = () =>
    Promise.resolve(
      new Response(body, { status, statusText: status === 404 ? 'Not Found' : 'OK', headers }),
    );
  return { request: { url, method }, next };
}

describe('the landing middleware', () => {
  test('reports a rewritten landing as found instead of not found', async () => {
    // Measured on the deploy: Pages resolves /invite/<code> to the shell through
    // the _redirects rewrite but keeps the not-found status of the asked path.
    // Share crawlers drop a 404 before they read the tags written just above.
    const res = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD' }));
    expect(res.status).toBe(200);
    // A promoted status must not keep "Not Found" as its reason phrase.
    expect(res.statusText).toBe('');
    const html = await res.text();
    expect(html).toContain('RealUnit — Einladung AB12CD');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  test('a promo landing is promoted the same way', async () => {
    const res = await onRequest(
      context({ url: 'https://realunit.app/promo/EVT1', body: PROMO_SHELL }),
    );
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('');
    expect(await res.text()).toContain('RealUnit — Promo-Code EVT1');
  });

  test('a real 404 page on a landing path keeps saying 404', async () => {
    // A broken deploy has to stay visibly broken rather than look healthy.
    const res = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', body: NOT_FOUND_PAGE }),
    );
    expect(res.status).toBe(404);
    // Untouched status keeps its reason phrase.
    expect(res.statusText).toBe('Not Found');
  });

  test('a landing that was already found keeps its status', async () => {
    const res = await onRequest(context({ url: 'https://realunit.app/invite/', status: 200 }));
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
  });

  test('a path the rewrite does not own is passed through untouched', async () => {
    const ctx = context({ url: 'https://realunit.app/', status: 200 });
    const res = await onRequest(ctx);
    expect(await res.text()).toBe(SHELL);
    // Passed through, so the header the rewrite would have dropped is still there.
    expect(res.headers.get('content-length')).toBe(String(SHELL.length));
  });

  test('a non-GET request is passed through untouched', async () => {
    const res = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', method: 'HEAD' }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('content-length')).toBe(String(SHELL.length));
  });

  test('a response that is not HTML is passed through untouched', async () => {
    const res = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', type: 'application/json', body: '{}' }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{}');
  });

  test('the marker the promotion keys on lives where it has to', () => {
    // The contract the two tests above rely on, asserted against the shipped
    // files rather than assumed.
    expect(SHELL).toContain('id="state-loading"');
    expect(PROMO_SHELL).toContain('id="state-loading"');
    expect(NOT_FOUND_PAGE).not.toContain('id="state-loading"');
  });

  test('a response with no content-type is passed through untouched', async () => {
    // Constructing a Response from a string sets content-type on its own, so
    // the header is removed again to reach the missing-header path.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    ctx.next = () => {
      const res = new Response(SHELL, { status: 404 });
      res.headers.delete('content-type');
      return Promise.resolve(res);
    };
    const res = await onRequest(ctx);
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.status).toBe(404);
  });
});
