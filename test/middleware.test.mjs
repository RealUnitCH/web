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

// The header values public/_headers really sets, read from the file so the
// fixture cannot drift from production. This checks that the middleware passes
// them through — a dropped security header does not show up in coverage, which
// measures execution and not values. It does not review the policy itself:
// changing _headers moves both sides together, by design.
function headerRule(pattern, name) {
  const rules = page('_headers').split(/\r?\n/);
  const start = rules.findIndex((line) => line.trim() === pattern);
  if (start < 0) throw new Error(`public/_headers has no rule for ${pattern}`);
  for (const line of rules.slice(start + 1)) {
    if (!line.startsWith(' ') && !line.startsWith('\t')) break;
    const [key, ...rest] = line.trim().split(':');
    if (key.toLowerCase() === name) return rest.join(':').trim();
  }
  throw new Error(`public/_headers sets no ${name} for ${pattern}`);
}

const SITE_HEADERS = {
  'content-security-policy': headerRule('/*', 'content-security-policy'),
  'x-content-type-options': headerRule('/*', 'x-content-type-options'),
  'x-frame-options': headerRule('/*', 'x-frame-options'),
  'referrer-policy': headerRule('/*', 'referrer-policy'),
  'cache-control': headerRule('/invite/*', 'cache-control'),
};
const SHELL = page('invite/index.html');
const PROMO_SHELL = page('promo/index.html');
const NOT_FOUND_PAGE = page('404.html');
// .length counts UTF-16 units; a Content-Length counts bytes, and these pages
// carry multi-byte characters.
const bytes = (text) => new TextEncoder().encode(text).length;
const SHELL_BYTES = bytes(SHELL);
const NOT_FOUND_BYTES = bytes(NOT_FOUND_PAGE);

function context({
  url,
  method = 'GET',
  status = 404,
  body = SHELL,
  type = 'text/html; charset=utf-8',
  requestHeaders = {},
}) {
  const headers = new Headers({
    'content-type': type,
    'content-length': String(bytes(body)),
    ...SITE_HEADERS,
  });
  const forwarded = [];
  const next = (request) => {
    forwarded.push(request || ctx.request);
    // 204, 205 and 304 cannot be built with a body — which is the very thing
    // the middleware has to respect when it rebuilds the response.
    const upstream = status === 204 || status === 205 || status === 304 ? null : body;
    return Promise.resolve(
      new Response(upstream, { status, statusText: status === 404 ? 'Not Found' : 'OK', headers }),
    );
  };
  // A real Request, because the middleware derives the GET-equivalent from it.
  const ctx = { request: new Request(url, { method, headers: requestHeaders }), next, forwarded };
  return ctx;
}

describe('the landing middleware', () => {
  test('reports a rewritten landing as found instead of not found', async () => {
    // Measured on the deploy: Pages resolves /invite/<code> to the shell through
    // the _redirects rewrite but keeps the not-found status of the asked path.
    // Share crawlers drop a 404 before they read the rewritten meta tags.
    const res = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD' }));
    expect(res.status).toBe(200);
    // A promoted status must not keep "Not Found" as its reason phrase.
    expect(res.statusText).toBe('');
    const html = await res.text();
    expect(html).toContain('RealUnit — Einladung AB12CD');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    for (const [name, value] of Object.entries(SITE_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  test('the media type is read as a media type, not as a substring', async () => {
    // RFC 9110 makes it case-insensitive, and a parameter that merely contains
    // the words is not the type.
    const mixedCase = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', type: 'Text/HTML; charset=UTF-8' }),
    );
    expect(mixedCase.status).toBe(200);
    expect(await mixedCase.text()).toContain('RealUnit — Einladung AB12CD');

    // The body is the shell, so a substring match would actually rewrite it —
    // with '{}' the marker guard would hand it on either way and the check
    // would prove nothing.
    const lookalike = await onRequest(
      context({
        url: 'https://realunit.app/invite/AB12CD',
        type: 'application/json; profile="text/html"',
      }),
    );
    expect(lookalike.status).toBe(404);
    expect(await lookalike.text()).toBe(SHELL);
    expect(lookalike.headers.get('content-type')).toBe('application/json; profile="text/html"');
  });

  test('a body in another encoding is handed on byte for byte', async () => {
    // Real ISO-8859-1 bytes, not a JS string: 0xE9 is 'é' there and is not
    // valid UTF-8 at all. The body carries the landing marker, so only the
    // charset guard stands between it and the rewrite — without it,
    // response.text() would turn that byte into U+FFFD and the answer would go
    // out as different bytes under a UTF-8 label.
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<section id="state-loading">'),
      0xe9,
      ...new TextEncoder().encode('</section>'),
    ]);
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    ctx.next = () =>
      Promise.resolve(
        new Response(latin1, {
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'text/html; charset=iso-8859-1' }),
        }),
      );
    const res = await onRequest(ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/html; charset=iso-8859-1');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(latin1);
  });

  test('the charset is read whatever shape it comes in', async () => {
    const rewritten = async (type) => {
      const res = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD', type }));
      return res.status === 200;
    };
    // Quoted, unusually spelled and differently cased UTF-8 all still count —
    // the parameter name is case-insensitive too.
    expect(await rewritten('text/html; charset="utf-8"')).toBe(true);
    expect(await rewritten('Text/HTML;Charset="utf-8"')).toBe(true);
    expect(await rewritten('text/html; CHARSET=iso-8859-1')).toBe(false);
    expect(await rewritten('text/html; charset=UTF8')).toBe(true);
    expect(await rewritten('text/html;charset=utf-8')).toBe(true);
    // Anything else is handed on rather than decoded as UTF-8 and relabelled.
    expect(await rewritten('text/html; charset=utf-16')).toBe(false);
    expect(await rewritten('text/html; charset=windows-1252')).toBe(false);
    expect(await rewritten('text/html; charset="iso-8859-1"')).toBe(false);
    // A semicolon inside a quoted value is not a parameter separator, so the
    // charset that counts is the real one behind it.
    expect(await rewritten('text/html; foo="x;charset=utf-8"; charset=iso-8859-1')).toBe(false);
    expect(await rewritten('text/html; foo="x;charset=iso-8859-1"; charset=utf-8')).toBe(true);
    // Two that disagree means hands off rather than picking one, whichever way
    // round they come: neither the first nor the last wins.
    expect(await rewritten('text/html; charset=utf-8; charset=iso-8859-1')).toBe(false);
    expect(await rewritten('text/html; charset=iso-8859-1; charset=utf-8')).toBe(false);
    // A backslash escapes the next character inside a quoted value, so the
    // closing quote here is part of the value and the real charset follows.
    expect(await rewritten('text/html; foo="a\\";charset=utf-8"; charset=iso-8859-1')).toBe(false);
    expect(await rewritten('text/html; foo="a\\";charset=iso-8859-1"; charset=utf-8')).toBe(true);
  });

  test('a rewritten answer says UTF-8 even when the origin left it out', async () => {
    // The body was read as UTF-8 and goes out as UTF-8, so the answer says so
    // rather than leaving the client to guess.
    const res = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', type: 'text/html' }),
    );
    expect(res.status).toBe(200);
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

  test('a refusal on a landing path is passed on, not promoted', async () => {
    // Only the 404 Pages produces for these paths is an artefact. A 403 or a
    // 410 means what it says, even when the body happens to be the shell.
    for (const status of [403, 410]) {
      // The encoding has to be there for its absence afterwards to mean
      // anything — asserting against a header the fixture never set is no test.
      const ctx = context({ url: 'https://realunit.app/invite/AB12CD', status });
      ctx.next = () =>
        Promise.resolve(
          new Response(SHELL, {
            status,
            statusText: 'OK',
            headers: new Headers({
              'content-type': 'text/html; charset=utf-8',
              'content-length': String(SHELL_BYTES),
              'content-encoding': 'gzip',
              ...SITE_HEADERS,
            }),
          }),
        );
      const res = await onRequest(ctx);
      expect(res.status).toBe(status);
      expect(res.statusText).toBe('OK');
      // The rewrite still runs; what must not change is the status. And since
      // it runs, the headers it invalidates have to go here as well — a
      // content-length from before the rewrite would contradict the body.
      expect(await res.text()).toContain('RealUnit — Einladung AB12CD');
      expect(res.headers.get('content-length')).toBeNull();
      expect(res.headers.get('content-encoding')).toBeNull();
    }
  });

  test('conditional headers are stripped from the GET-equivalent', async () => {
    // Range would allow a 206, the conditional headers a 304 or a 412. None of
    // those bodies is the landing shell, and the status is decided from the
    // body.
    const ctx = context({
      url: 'https://realunit.app/invite/AB12CD',
      requestHeaders: {
        'if-none-match': 'W/"abc"',
        'if-modified-since': 'Tue, 09 Sep 2026 00:00:00 GMT',
        'if-match': 'W/"abc"',
        'if-unmodified-since': 'Tue, 09 Sep 2026 00:00:00 GMT',
        'accept-language': 'de-CH',
      },
    });
    const res = await onRequest(ctx);
    const [forwarded] = ctx.forwarded;
    for (const name of ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since']) {
      expect(forwarded.headers.get(name)).toBeNull();
    }
    expect(forwarded.headers.get('accept-language')).toBe('de-CH');
    // And the answer that comes back is the whole document, not a 304.
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('RealUnit — Einladung AB12CD');
  });

  test('a GET that carries a body is still answered, not thrown on', async () => {
    // The Request constructor refuses to pair a body with GET, so re-methoding
    // such a request throws. It is rebuilt from the URL instead, which drops
    // the platform's request metadata but keeps the request answerable.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    const withBody = new Request('https://realunit.app/invite/AB12CD', {
      method: 'POST',
      body: 'not what a GET should carry',
    });
    withBody.headers.set('range', 'bytes=0-99');
    withBody.headers.set('content-length', '27');
    withBody.headers.set('if-none-match', 'W/"abc"');
    withBody.headers.set('accept-language', 'de-CH');
    Object.defineProperty(withBody, 'method', { value: 'GET' });
    ctx.request = withBody;
    const res = await onRequest(ctx);
    const [forwarded] = ctx.forwarded;
    expect(forwarded.method).toBe('GET');
    expect(forwarded.url).toBe('https://realunit.app/invite/AB12CD');
    // The fallback has to carry the cleaned headers, not the original ones.
    expect(forwarded.headers.get('range')).toBeNull();
    expect(forwarded.headers.get('if-none-match')).toBeNull();
    expect(forwarded.headers.get('accept-language')).toBe('de-CH');
    // The rebuilt request carries no body, so it must not announce one.
    expect(forwarded.headers.get('content-length')).toBeNull();
    expect(forwarded.headers.get('content-type')).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('RealUnit — Einladung AB12CD');
  });

  test('a status that must not carry a body is passed on instead of throwing', async () => {
    // Pairing 204, 205 or 304 with a body throws, which would turn such an
    // answer into a 500.
    for (const status of [204, 205, 304]) {
      const ctx = context({ url: 'https://realunit.app/invite/AB12CD', status });
      let upstream;
      ctx.next = () => {
        upstream = new Response(null, {
          status,
          headers: new Headers({
            'content-type': 'text/html; charset=utf-8',
            etag: 'W/"the-one-it-was-matched-on"',
            ...SITE_HEADERS,
          }),
        });
        return Promise.resolve(upstream);
      };
      const res = await onRequest(ctx);
      // The origin's own answer, like the other pass-through branches.
      expect(res).toBe(upstream);
      expect(res.status).toBe(status);
      expect(res.body).toBeNull();
      // A 304 has to keep the validator it was matched on, and none of these
      // carries a representation this pass could rewrite.
      expect(res.headers.get('etag')).toBe('W/"the-one-it-was-matched-on"');
    }
  });

  test('the length, encoding, validators and range are dropped after a rewrite', async () => {
    // A stale validator is worse than none: a conditional request would be
    // answered 304 against a document the client never received.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    ctx.next = () => {
      const res = new Response(SHELL, {
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(SHELL_BYTES),
          etag: 'W/"before-the-rewrite"',
          'last-modified': 'Tue, 09 Sep 2026 00:00:00 GMT',
          'content-range': 'bytes 0-99/4162',
          'accept-ranges': 'bytes',
          // The body left here decoded, so a carried-over encoding would be
          // wrong whatever the origin declared.
          'content-encoding': 'gzip',
          // Not observed on this deploy, dropped for the same reason as the
          // validators: they describe bytes this pass replaces.
          'content-digest': 'sha-256=:before:',
          'repr-digest': 'sha-256=:before:',
          digest: 'sha-256=before',
          'content-md5': 'before',
          ...SITE_HEADERS,
        }),
      });
      return Promise.resolve(res);
    };
    const res = await onRequest(ctx);
    expect(res.status).toBe(200);
    for (const stale of [
      'content-length',
      'content-encoding',
      'etag',
      'last-modified',
      'content-range',
      'accept-ranges',
      'content-digest',
      'repr-digest',
      'digest',
      'content-md5',
    ]) {
      expect(res.headers.get(stale)).toBeNull();
    }
    // The ones the rewrite does not invalidate stay.
    for (const [name, value] of Object.entries(SITE_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  test('a partial answer is passed on instead of being rewritten', async () => {
    // The body is a fragment, so injecting into it and dropping the range
    // metadata would produce a 206 that describes nothing.
    let partialUpstream;
    const partial = (method) => {
      const ctx = context({ url: 'https://realunit.app/invite/AB12CD', status: 206, method });
      // The realistic case: a partial view of the landing page itself. A body
      // that is not the shell would be handed on by the marker guard anyway,
      // and would not prove this guard does anything.
      ctx.next = () => {
        partialUpstream = new Response(SHELL, {
          status: 206,
          headers: new Headers({
            'content-type': 'text/html; charset=utf-8',
            // Real byte counts: .length counts UTF-16 units, and a range has
            // to describe bytes of something that exists.
            'content-length': String(SHELL_BYTES),
            'content-range': `bytes 0-${SHELL_BYTES - 1}/${SHELL_BYTES}`,
            etag: 'W/"the-whole-thing"',
            ...SITE_HEADERS,
          }),
        });
        return Promise.resolve(partialUpstream);
      };
      return onRequest(ctx);
    };

    const res = await partial('GET');
    // The origin's own answer on the GET path, as on the other branches.
    expect(res).toBe(partialUpstream);
    expect(res.status).toBe(206);
    // Handed on as it came: not rewritten, though the body is the shell.
    expect(await res.text()).toBe(SHELL);
    expect(res.headers.get('content-length')).toBe(String(SHELL_BYTES));
    // Nothing was rewritten, so the range metadata and the validator still
    // describe what the origin sent.
    expect(res.headers.get('content-range')).toBe(`bytes 0-${SHELL_BYTES - 1}/${SHELL_BYTES}`);
    expect(res.headers.get('etag')).toBe('W/"the-whole-thing"');

    // A HEAD on the same answer keeps the status and the headers, and drops
    // only the body.
    const head = await partial('HEAD');
    expect(head.status).toBe(206);
    expect(head.body).toBeNull();
    expect(head.headers.get('content-length')).toBe(String(SHELL_BYTES));
    expect(head.headers.get('content-range')).toBe(`bytes 0-${SHELL_BYTES - 1}/${SHELL_BYTES}`);
    expect(head.headers.get('etag')).toBe('W/"the-whole-thing"');
  });

  // The origin's own answer for the two cases below. The GET case can require
  // that this very object comes back, which no look-alike would satisfy; the
  // HEAD case cannot, because a body-less answer has to be a new object, so it
  // compares the whole status and header set instead.
  function notFoundUpstream(method) {
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', method });
    let upstream;
    ctx.next = (request) => {
      // The recorder the default next() provides, kept: the HEAD case has to
      // show that a GET-equivalent was asked for.
      ctx.forwarded.push(request || ctx.request);
      upstream = new Response(NOT_FOUND_PAGE, {
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(NOT_FOUND_BYTES),
          'content-encoding': 'gzip',
          etag: 'W/"the-404-page"',
          ...SITE_HEADERS,
        }),
      });
      return Promise.resolve(upstream);
    };
    return { ctx, sent: () => upstream };
  }

  test('a real 404 page on a landing path keeps saying 404', async () => {
    // A broken deploy has to stay visibly broken rather than look healthy.
    const { ctx, sent } = notFoundUpstream('GET');
    const res = await onRequest(ctx);
    expect(res.status).toBe(404);
    // Untouched status keeps its reason phrase.
    expect(res.statusText).toBe('Not Found');
    // Handed on as the origin's own answer, not rebuilt from its text: that is
    // what keeps the encoding and the validator describing the actual bytes.
    expect(res).toBe(sent());
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('etag')).toBe('W/"the-404-page"');
    // And an untouched page keeps its own copy: rewriting the 404 page's title
    // into an invitation would misdescribe what the visitor is looking at.
    expect(await res.text()).toBe(NOT_FOUND_PAGE);
  });

  test('a landing that was already found keeps its status and is still rewritten', async () => {
    // The promotion is not the only thing this pass does. An answer that
    // already said 200 still gets its tags written, so a change that handed
    // those through untouched has somewhere to fail.
    const res = await onRequest(context({ url: 'https://realunit.app/invite/', status: 200 }));
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.headers.get('content-length')).toBeNull();
    // Measured: on this codeless landing the rewrite normalises the canonical
    // and the two URL tags to the form without a trailing slash. The shell
    // ships them with one, so this holds only if the rewrite actually ran.
    const html = await res.text();
    expect(html).toContain('rel="canonical" href="https://realunit.app/invite"');
    expect(html).toContain('property="og:url" content="https://realunit.app/invite"');
  });

  test('a path the rewrite does not own is passed through untouched', async () => {
    const ctx = context({ url: 'https://realunit.app/', status: 200 });
    const res = await onRequest(ctx);
    expect(await res.text()).toBe(SHELL);
    // Passed through, so the header the rewrite would have dropped is still there.
    expect(res.headers.get('content-length')).toBe(String(SHELL_BYTES));
  });

  test('HEAD answers like GET by asking for the GET-equivalent', async () => {
    // A link checker sends HEAD first. A HEAD response has no body, and the
    // body is what tells the landing shell from the site's 404 page — so the
    // status has to come from a GET-equivalent lookup, or the same link would
    // read as found by GET and as dead by HEAD.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', method: 'HEAD' });
    const head = await onRequest(ctx);
    const get = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD' }));
    expect(ctx.forwarded.map((r) => r.method)).toEqual(['GET']);
    expect(head.status).toBe(get.status);
    expect(head.status).toBe(200);
    expect(head.statusText).toBe('');
    // No body at all, not an empty one: `new Response('')` would still carry a
    // stream, and text() cannot tell the two apart.
    expect(head.body).toBeNull();
    expect(await head.text()).toBe('');
    for (const name of ['content-type', ...Object.keys(SITE_HEADERS)]) {
      expect(head.headers.get(name)).toBe(get.headers.get(name));
    }
    expect(head.headers.get('content-length')).toBeNull();
  });

  test('a plain GET with Range is forwarded without it', async () => {
    // This pass rewrites the whole document, so a partial representation is
    // never useful: it would be injected into a fragment and returned under a
    // Content-Range describing the bytes before the rewrite.
    const ctx = context({
      url: 'https://realunit.app/invite/AB12CD',
      requestHeaders: { range: 'bytes=0-99', 'if-range': 'W/"abc"' },
    });
    const res = await onRequest(ctx);
    const [forwarded] = ctx.forwarded;
    expect(forwarded.method).toBe('GET');
    expect(forwarded.headers.get('range')).toBeNull();
    expect(forwarded.headers.get('if-range')).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('RealUnit — Einladung AB12CD');
  });

  test('the GET-equivalent drops Range and keeps the unrelated headers', async () => {
    // A HEAD carrying Range would otherwise come back as 206, whose body is not
    // the landing shell — the status would neither be promoted nor mean what
    // the client asked for. Headers unrelated to choosing the representation
    // are kept; the conditional ones are covered by their own case above.
    const ctx = context({
      url: 'https://realunit.app/invite/AB12CD',
      method: 'HEAD',
      requestHeaders: {
        range: 'bytes=0-99',
        'if-range': 'W/"abc"',
        'accept-language': 'en-GB',
        'user-agent': 'link-checker/1.0',
      },
    });
    await onRequest(ctx);
    const [forwarded] = ctx.forwarded;
    expect(forwarded.method).toBe('GET');
    expect(forwarded.headers.get('range')).toBeNull();
    expect(forwarded.headers.get('if-range')).toBeNull();
    expect(forwarded.headers.get('accept-language')).toBe('en-GB');
    expect(forwarded.headers.get('user-agent')).toBe('link-checker/1.0');
    expect(forwarded.url).toBe(ctx.request.url);
  });

  test('a HEAD on a real 404 page keeps saying 404', async () => {
    // The marker guard has to hold on the HEAD path too, not only on GET.
    const { ctx, sent } = notFoundUpstream('HEAD');
    const res = await onRequest(ctx);
    expect(ctx.forwarded.map((r) => r.method)).toEqual(['GET']);
    expect(res.status).toBe(404);
    expect(res.statusText).toBe('Not Found');
    expect(res.body).toBeNull();
    // Only the body is left off; every header the origin sent is still there.
    for (const [name, value] of sent().headers) {
      expect(res.headers.get(name)).toBe(value);
    }
    expect([...res.headers.keys()].sort()).toEqual([...sent().headers.keys()].sort());
  });

  test('a HEAD on a response that is not HTML keeps its status and carries no body', async () => {
    const ctx = context({
      url: 'https://realunit.app/invite/AB12CD',
      method: 'HEAD',
      type: 'application/json',
      body: '{}',
    });
    // Nothing was rewritten here, so every header still describes what the
    // origin sent and must survive — the length included, which RFC 9110 wants
    // a HEAD to carry as the GET would have.
    ctx.next = () => {
      const headers = new Headers({
        'content-type': 'application/json',
        'content-length': '2',
        etag: 'W/"unchanged"',
        'content-encoding': 'gzip',
        ...SITE_HEADERS,
      });
      return Promise.resolve(new Response('{}', { status: 404, statusText: 'Not Found', headers }));
    };
    const res = await onRequest(ctx);
    // Every header the origin sent survives, name for name — listing a few by
    // hand would miss a regression that drops one nobody thought to name.
    const sent = new Headers({
      'content-type': 'application/json',
      'content-length': '2',
      etag: 'W/"unchanged"',
      'content-encoding': 'gzip',
      ...SITE_HEADERS,
    });
    for (const [name, value] of sent) {
      expect(res.headers.get(name)).toBe(value);
    }
    expect([...res.headers.keys()].sort()).toEqual([...sent.keys()].sort());
    expect(res.status).toBe(404);
    expect(res.statusText).toBe('Not Found');
    expect(res.body).toBeNull();
    // The length still describes the representation a GET would have returned.
    expect(res.headers.get('content-length')).toBe('2');
    // This branch rebuilds the response too, so it has to carry the headers.
    for (const [name, value] of Object.entries(SITE_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  test('a method that is neither GET nor HEAD is passed through untouched', async () => {
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', method: 'POST' });
    let upstream;
    ctx.next = () => {
      upstream = new Response(SHELL, {
        status: 404,
        headers: new Headers({
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(SHELL_BYTES),
          etag: 'W/"untouched"',
        }),
      });
      return Promise.resolve(upstream);
    };
    const res = await onRequest(ctx);
    // The origin's own answer, as with the other pass-through branches.
    expect(res).toBe(upstream);
    expect(res.status).toBe(404);
    expect(res.headers.get('etag')).toBe('W/"untouched"');
    expect(await res.text()).toBe(SHELL);
  });

  test('a response that is not HTML is passed through untouched', async () => {
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    let upstream;
    ctx.next = () => {
      upstream = new Response('{}', {
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'application/json',
          'content-length': '2',
          'content-encoding': 'gzip',
          etag: 'W/"the-json"',
          ...SITE_HEADERS,
        }),
      });
      return Promise.resolve(upstream);
    };
    const res = await onRequest(ctx);
    // The origin's own answer, not one rebuilt to look like it.
    expect(res).toBe(upstream);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{}');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('etag')).toBe('W/"the-json"');
  });

  test('the marker has to be the attribute, not the words', async () => {
    // A page that merely mentions state-loading is not a landing shell. A
    // looser match would promote it from 404 to 200 and rewrite its title.
    const mentionsIt =
      '<html lang="de"><head><title>Seite nicht gefunden</title></head>' +
      '<body><p>Der Abschnitt state-loading fehlt.</p></body></html>';
    const res = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', body: mentionsIt }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(mentionsIt);
  });

  test('the marker the promotion keys on lives where it has to', () => {
    // The contract the promotion tests rely on, asserted against the shipped
    // files rather than assumed.
    expect(SHELL).toContain('id="state-loading"');
    expect(PROMO_SHELL).toContain('id="state-loading"');
    expect(NOT_FOUND_PAGE).not.toContain('id="state-loading"');
  });

  test('a response with no content-type is passed through untouched', async () => {
    // Constructing a Response from a string sets content-type on its own, so
    // the header is removed again to reach the missing-header path.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    let upstream;
    ctx.next = () => {
      upstream = new Response(SHELL, { status: 404 });
      upstream.headers.delete('content-type');
      upstream.headers.set('etag', 'W/"no-type"');
      return Promise.resolve(upstream);
    };
    const res = await onRequest(ctx);
    // The origin's own answer again, not a look-alike.
    expect(res).toBe(upstream);
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.headers.get('etag')).toBe('W/"no-type"');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(SHELL);
  });
});
