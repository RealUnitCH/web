/**
 * Serve the invite and promo landings for the paths people actually share, and
 * rewrite their metadata so a share crawler sees the campaign in the HTML
 * bytes: apple-itunes-app already carries app-argument, og:url / canonical /
 * twitter:url already name the landing URL, og:title / twitter:title /
 * og:description already name the code, ?lang=en already sets html lang and
 * og:locale, the Facebook App Links are present, and a code-bearing store
 * hand-off names the code. Safari, Play and share crawlers can snapshot those
 * before /js/invite-banner.js and invite.js run.
 *
 * public/ stays generic; this is not a site-wide renderer.
 */
import {
  injectLandingFromRequestUrl,
  isLandingShell,
  shouldRewriteItunesBanner,
} from './lib/itunes-banner.js';

/**
 * The shell each landing path is served from. `_redirects` names the same two
 * files, but its 200-rewrites never run for these paths: `_routes.json` hands
 * the request to this Function first, and the asset lookup behind
 * context.next() resolves the path as asked rather than as rewritten.
 *
 * Measured on the deploy, with the three lookups side by side on
 * /invite/AB12CD: context.next() answers 404 with the site's own 404 page,
 * context.next() handed a request for /invite/index.html answers 308, and
 * env.ASSETS.fetch() of that same file answers 200 with the shell. So the
 * shell is read from the asset binding, by name.
 */
const LANDING_SHELL = { invite: '/invite/index.html', promo: '/promo/index.html' };

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!shouldRewriteItunesBanner(url.pathname)) {
    return context.next();
  }
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return context.next();
  }
  // The platform's own answer first, because most of what it says is right and
  // only one case is not. A real file under these paths comes back 200 — that
  // is /invite/ and /promo/ themselves — and /invite/index.html comes back as
  // the 308 that canonicalises it. Both stand. Only the code-bearing paths
  // come back 404, because the 200-rewrite that was meant to resolve them
  // never runs, and those are the ones this pass has to answer itself.
  const platform = await context.next();
  if (platform.status !== 200 && platform.status !== 404) {
    return platform;
  }
  if (platform.status === 200 && !isHtml(platform.headers.get('content-type'))) {
    // Some other asset under these paths. Not ours to rewrite.
    return platform;
  }
  if (method === 'GET' && platform.status === 200) {
    // The file is already the right one; the metadata and the code-bearing
    // store hand-off have to go in, and its own status stays.
    const html = await platform.clone().text();
    if (!isLandingShell(html)) {
      return platform;
    }
    return answer(html, platform.headers, context.request, method, platform.status);
  }
  // What is left is a 404 to replace, or a HEAD. A HEAD answer carries no
  // body, and the body is what tells the landing shell from any other page —
  // deciding from an empty one would hand back the file's own validators
  // beside a GET that had them stripped. Both cases therefore read the shell
  // from the binding, and both answer as the GET does.
  const assets = context.env && context.env.ASSETS;
  if (!assets) {
    // No binding, no shell to read. The platform's answer stands: it is the
    // wrong page, but it is not one this pass invented.
    return platform;
  }
  const shellPath = url.pathname.startsWith('/promo') ? LANDING_SHELL.promo : LANDING_SHELL.invite;
  // Always a GET, whatever the client sent: the body is what tells the landing
  // shell from any other file under that name, and a HEAD would come back
  // without one. Asked in a try, because a binding that rejects would
  // otherwise take the whole Function down — and a Function that throws makes
  // Pages serve the assets directly, which is the very answer this replaces.
  let shell;
  let html;
  try {
    shell = await assets.fetch(new Request(new URL(shellPath, url).toString()));
    if (!shell.ok) {
      return platform;
    }
    html = await shell.text();
  } catch {
    return platform;
  }
  if (!isLandingShell(html)) {
    // The file under that name is not the landing shell any more. Serving it
    // as one would describe something the visitor is not looking at.
    return platform;
  }
  // The headers describe the URL that was asked for, so they come from the
  // platform's answer wherever it had one — public/_headers matches on the
  // request path, and the shell's own answer was matched on /invite/index.html.
  // Only when the platform had nothing to say does the shell's set stand in.
  const source = platform.status === 200 ? platform.headers : shell.headers;
  return answer(html, source, context.request, method);
}

/** Whether the answer is HTML at all, read as a media type and not a substring. */
function isHtml(contentType) {
  return (
    String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase() === 'text/html'
  );
}

/**
 * The landing, with the campaign written into it.
 */
function answer(html, sourceHeaders, request, method, status = 200) {
  const injected = injectLandingFromRequestUrl(html, request.url);
  // The source's headers, minus the ones the rewrite invalidates. They have to
  // be carried: public/_headers is applied to the asset, not to an answer this
  // Function builds, so starting from an empty set drops the site's
  // Content-Security-Policy, X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy and Cache-Control from every landing. Measured on a
  // preview deploy, with and without the copy.
  //
  // What must not be carried is anything describing the bytes before the
  // injection: the length, the content coding — text() decoded the body and
  // what leaves here is plain text — both validators, and the integrity
  // digests of RFC 9530 and its predecessors. A stale validator is the one
  // that does damage: a conditional request would be answered 304 against a
  // document the client never received.
  const headers = new Headers(sourceHeaders);
  for (const stale of [
    'content-length',
    'content-encoding',
    'etag',
    'last-modified',
    'content-digest',
    'repr-digest',
    'digest',
    'content-md5',
  ]) {
    headers.delete(stale);
  }
  headers.set('content-type', 'text/html; charset=utf-8');
  // The shell exists, so a code-bearing path is answered 200 — for HEAD as
  // well as for GET. That is the whole point: WhatsApp, iMessage, Slack,
  // Facebook and X drop a 404 before they read the tags just written.
  return new Response(method === 'HEAD' ? null : injected, { status, headers });
}
