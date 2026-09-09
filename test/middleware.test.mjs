import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { onRequest } from '../functions/_middleware.js';
import { isLandingShell } from '../functions/lib/itunes-banner.js';

// The real files, not a hand-written stand-in. The pass keys on marks that
// live in the landing shells and must never appear in the site's 404 page; a
// synthetic fixture would keep passing after someone moved one of them, and
// production would go back to serving the 404 page with nothing going red.
const page = (name) => readFileSync(resolve('public', name), 'utf8');

// Every page the site ships, named the way page() wants them.
const shippedHtml = (dir = 'public') =>
  readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return shippedHtml(path);
    return entry.name.endsWith('.html') ? [path.slice('public/'.length)] : [];
  });

const SHELL = page('invite/index.html');
const PROMO_SHELL = page('promo/index.html');
const NOT_FOUND_PAGE = page('404.html');
// .length counts UTF-16 units; a Content-Length counts bytes, and these pages
// carry multi-byte characters.
const bytes = (text) => new TextEncoder().encode(text).length;

// The platform's own answer on a landing path, which is what this pass exists
// to replace: `_routes.json` hands the request here first, so the 200-rewrite
// in `_redirects` never runs and the asset lookup answers with the 404 page.
function notFoundAnswer(method) {
  return new Response(method === 'HEAD' ? null : NOT_FOUND_PAGE, {
    status: 404,
    statusText: 'Not Found',
    headers: new Headers({
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(bytes(NOT_FOUND_PAGE)),
      etag: 'W/"the-404-page"',
    }),
  });
}

function context({
  url,
  method = 'GET',
  shell = SHELL,
  shellStatus = 200,
  shellHeaders = {},
  withAssets = true,
  platformAnswer: makePlatform = notFoundAnswer,
} = {}) {
  const nextCalls = [];
  const assetFetches = [];
  const assetMethods = [];
  let platform;
  const ctx = {
    request: new Request(url, { method }),
    next: (request) => {
      nextCalls.push(request);
      platform = makePlatform(method);
      return Promise.resolve(platform);
    },
    nextCalls,
    assetFetches,
    assetMethods,
    platform: () => platform,
  };
  if (withAssets) {
    ctx.env = {
      ASSETS: {
        fetch: (request) => {
          assetFetches.push(request.url);
          assetMethods.push(request.method);
          // Path-aware, so that asking for the wrong shell returns the wrong
          // page rather than the one the case expects anyway.
          const file = request.url.endsWith('/promo/index.html') ? PROMO_SHELL : shell;
          return Promise.resolve(
            new Response(shellStatus === 200 ? file : 'no such asset', {
              status: shellStatus,
              headers: new Headers({
                'content-type': 'text/html; charset=utf-8',
                'content-length': String(bytes(file)),
                ...shellHeaders,
              }),
            }),
          );
        },
      },
    };
  }
  return ctx;
}

describe('the landing middleware', () => {
  test('an invite link is answered 200 with the landing and its code', async () => {
    // The reason this pass exists. Before it, `/invite/<code>` was answered
    // with the site's 404 page — dressed in the campaign's title by the older
    // rewrite, but still the wrong page and still a 404, which WhatsApp,
    // iMessage, Slack, Facebook and X drop before reading any of the tags.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    const res = await onRequest(ctx);
    expect(res.status).toBe(200);
    expect(ctx.assetFetches).toEqual(['https://realunit.app/invite/index.html']);
    // The platform is asked first and with no argument of ours; its 404 is
    // what says the rewrite never resolved this path.
    expect(ctx.nextCalls).toEqual([undefined]);
    const html = await res.text();
    expect(html).toContain('RealUnit — Einladung AB12CD');
    // The tag itself is in both shells already, so the value is what proves
    // the injection ran.
    expect(html).toContain('<meta property="og:title" content="RealUnit — Einladung AB12CD"');
    // The shell it was built from, not the 404 page.
    expect(isLandingShell(html)).toBe(true);
  });

  test('the shell is always asked for with GET, whatever the client sent', async () => {
    // The body is what tells the landing shell from any other file under that
    // name. A HEAD forwarded to the binding would come back without one, the
    // marks would not be found, and the answer would fall back to the 404 the
    // platform gave — which is the bug this pass exists to remove.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', method: 'HEAD' });
    const res = await onRequest(ctx);
    expect(ctx.assetMethods).toEqual(['GET']);
    expect(res.status).toBe(200);
  });

  test('a binding that rejects leaves the platform answer standing', async () => {
    // A Function that throws makes Pages serve the assets directly, which is
    // exactly the wrong answer this pass replaces. Measured once, the hard way.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD' });
    ctx.env = { ASSETS: { fetch: () => Promise.reject(new Error('binding is having a day')) } };
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(res.status).toBe(404);
  });

  test('a promo link is served from the promo shell, not the invite one', async () => {
    const ctx = context({ url: 'https://realunit.app/promo/EVT1' });
    const res = await onRequest(ctx);
    expect(ctx.assetFetches).toEqual(['https://realunit.app/promo/index.html']);
    expect(res.status).toBe(200);
    // The code alone would also appear on an invitation-shaped injection; the
    // kind is what this case is about.
    expect(await res.text()).toContain('RealUnit — Promo-Code EVT1');
  });

  test('a HEAD gets the same status and no body', async () => {
    // A link checker sends HEAD first. It has to read what a GET would, or the
    // same link is found by one and dead by the other.
    const head = await onRequest(
      context({ url: 'https://realunit.app/invite/AB12CD', method: 'HEAD' }),
    );
    const get = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD' }));
    expect(head.status).toBe(get.status);
    expect(head.status).toBe(200);
    // No body at all, not an empty one: `new Response('')` still carries a
    // stream, and text() cannot tell the two apart.
    expect(head.body).toBeNull();
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
  });

  test('the whole request URL reaches the injection, not just its path', async () => {
    // ?lang=en is what switches the copy and og:locale, and it lives in the
    // query. Passing the pathname alone would still produce a landing, in the
    // wrong language, with nothing here to notice.
    const res = await onRequest(context({ url: 'https://realunit.app/invite/AB12CD?lang=en' }));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('RealUnit — Invitation AB12CD');
    expect(html).toContain('en_GB');
  });

  test('the headers the rewrite invalidates are dropped', async () => {
    // Each of these described the bytes before the injection. A length that no
    // longer matches, a coding the decoded body no longer has, a validator for
    // a document the client never received, a digest of other bytes.
    const ctx = context({
      url: 'https://realunit.app/invite/AB12CD',
      shellHeaders: {
        'cache-control': 'public, max-age=60',
        'content-security-policy': "default-src 'self'",
        'content-encoding': 'gzip',
        etag: 'W/"the-shell"',
        'last-modified': 'Tue, 09 Sep 2026 00:00:00 GMT',
        'content-digest': 'sha-256=:abc:',
        'repr-digest': 'sha-256=:abc:',
        digest: 'sha-256=abc',
        'content-md5': 'abc',
      },
    });
    const res = await onRequest(ctx);
    for (const name of [
      'content-length',
      'content-encoding',
      'etag',
      'last-modified',
      'content-digest',
      'repr-digest',
      'digest',
      'content-md5',
    ]) {
      expect(res.headers.get(name)).toBeNull();
    }
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    // And the ones that still describe the answer are carried: public/_headers
    // is applied to the asset, not to what this Function builds, so dropping
    // them would take the site's security headers off every landing.
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  test('a path the pass does not own is handed straight on', async () => {
    const ctx = context({ url: 'https://realunit.app/js/invite-banner.js' });
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(ctx.assetFetches).toEqual([]);
    // Handed on as it came, with no argument of ours.
    expect(ctx.nextCalls).toEqual([undefined]);
  });

  test('a method other than GET or HEAD is handed straight on', async () => {
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', method: 'POST' });
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(ctx.assetFetches).toEqual([]);
    expect(ctx.nextCalls).toEqual([undefined]);
  });

  test('without the asset binding the request is handed on, not invented', async () => {
    // The binding is what reaches the shell. Without it there is nothing
    // truthful to answer with, so the platform's own answer stands.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', withAssets: false });
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(res.status).toBe(404);
    expect(ctx.nextCalls).toEqual([undefined]);
  });

  test('a shell that cannot be read leaves the platform answer standing', async () => {
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', shellStatus: 404 });
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_PAGE);
  });

  test('a file under the shell name that is not the shell is refused', async () => {
    // A broken deploy that puts the 404 page at invite/index.html must not be
    // served as an invitation: the visitor would be told about something they
    // are not looking at.
    const ctx = context({ url: 'https://realunit.app/invite/AB12CD', shell: NOT_FOUND_PAGE });
    const res = await onRequest(ctx);
    expect(res).toBe(ctx.platform());
    expect(res.status).toBe(404);
  });

  test('the codeless landing is rewritten in place, not fetched again', async () => {
    // /invite/ is a real file, so the platform already answers it correctly.
    // Only the metadata has to be written in; the asset binding is not touched
    // and the status the platform gave stays.
    const ctx = context({
      url: 'https://realunit.app/invite/',
      platformAnswer: () =>
        new Response(SHELL, {
          status: 200,
          headers: new Headers({
            'content-type': 'text/html; charset=utf-8',
            'content-length': String(bytes(SHELL)),
            etag: 'W/"the-shell"',
          }),
        }),
    });
    const res = await onRequest(ctx);
    expect(ctx.assetFetches).toEqual([]);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('RealUnit — Einladung');
    expect(isLandingShell(html)).toBe(true);
    // Rewritten, so the headers that described the bytes before it are gone.
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
  });

  test("the platform's redirect on /invite/index.html is left alone", async () => {
    // Pages canonicalises the explicit file name to the directory. That is a
    // 308 and not this pass's business; answering it with the landing instead
    // would quietly create a second URL for the same page.
    let redirect;
    const ctx = context({
      url: 'https://realunit.app/invite/index.html',
      platformAnswer: () => {
        redirect = new Response(null, {
          status: 308,
          headers: new Headers({ location: '/invite/' }),
        });
        return redirect;
      },
    });
    const res = await onRequest(ctx);
    expect(res).toBe(redirect);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/invite/');
    expect(ctx.assetFetches).toEqual([]);
  });

  test('a non-HTML answer the platform gives is handed on untouched', async () => {
    let asset;
    const ctx = context({
      url: 'https://realunit.app/invite/',
      platformAnswer: () => {
        asset = new Response('{}', {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json', etag: 'W/"json"' }),
        });
        return asset;
      },
    });
    const res = await onRequest(ctx);
    expect(res).toBe(asset);
    expect(res.headers.get('etag')).toBe('W/"json"');
  });

  test('an HTML answer that is not the shell is handed on untouched', async () => {
    // A broken deploy serving the site's 404 page under /invite/ with a 200
    // must not be dressed up as an invitation.
    let other;
    const ctx = context({
      url: 'https://realunit.app/invite/',
      platformAnswer: () => {
        other = new Response(NOT_FOUND_PAGE, {
          status: 200,
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        });
        return other;
      },
    });
    const res = await onRequest(ctx);
    expect(res).toBe(other);
    expect(await res.text()).toBe(NOT_FOUND_PAGE);
  });

  test('the marks the pass keys on live where they have to', () => {
    for (const mark of ['id="state-loading"', 'aria-busy="true"']) {
      expect(SHELL).toContain(mark);
      expect(PROMO_SHELL).toContain(mark);
      expect(NOT_FOUND_PAGE).not.toContain(mark);
    }
  });

  test('of everything the site ships, only the two landings read as a shell', () => {
    // The check is a substring test: it does not require the two marks to
    // share an element, or to be in an element at all. What keeps that from
    // mattering is this property, and it is worth asserting rather than
    // describing. It goes red the day another page gains the second mark,
    // which is the day the guard would have to become a real parse.
    const files = shippedHtml().sort();
    expect(files).toEqual([
      '404.html',
      'account-merge/index.html',
      'confirm-aktionariat/index.html',
      'index.html',
      'invite/index.html',
      'promo/index.html',
    ]);
    expect(files.filter((file) => isLandingShell(page(file)))).toEqual([
      'invite/index.html',
      'promo/index.html',
    ]);
  });
});
