/**
 * Serve the invite and promo landings for the paths people actually share, and
 * rewrite their metadata so a share crawler sees the campaign in the HTML
 * bytes: apple-itunes-app already carries app-argument, og:url / canonical /
 * twitter:url already name the landing URL, og:title / twitter:title /
 * og:description already name the code, ?lang=en already sets html lang and
 * og:locale, and the Facebook App Links are present. Safari and every crawler
 * snapshot those before /js/invite-banner.js and invite.js run.
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
  const assets = context.env && context.env.ASSETS;
  if (!assets) {
    // No binding, no shell to read. Hand the request on rather than invent an
    // answer: the platform's own is wrong on these paths, but it is honest.
    return context.next();
  }
  const shellPath = url.pathname.startsWith('/promo') ? LANDING_SHELL.promo : LANDING_SHELL.invite;
  const shell = await assets.fetch(new Request(new URL(shellPath, url).toString()));
  if (!shell.ok) {
    return context.next();
  }
  const html = await shell.text();
  if (!isLandingShell(html)) {
    // The file under that name is not the landing shell any more. Serving it
    // as one would describe something the visitor is not looking at.
    return context.next();
  }
  const injected = injectLandingFromRequestUrl(html, context.request.url);
  const headers = new Headers(shell.headers);
  // Everything that described the bytes before the rewrite: the length, the
  // content coding — the body was decoded by text() and leaves here as plain
  // text — both validators, and the integrity digests of RFC 9530 and its
  // predecessors. A stale validator is worse than none: a conditional request
  // would be answered 304 against a document the client never received.
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
  // The shell exists, so the answer is 200 — for HEAD as well as for GET. That
  // is the whole point: WhatsApp, iMessage, Slack, Facebook and X drop a 404
  // before they read the tags this pass just wrote.
  return new Response(method === 'HEAD' ? null : injected, { status: 200, headers });
}
