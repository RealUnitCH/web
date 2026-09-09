/**
 * Rewrite invite/promo HTML so apple-itunes-app already carries
 * app-argument, og:url / canonical / twitter:url already name the
 * landing URL, og:title / twitter:title / og:description already name
 * the campaign code, ?lang=en already sets html lang / og:locale, and
 * Facebook App Links are present. Safari and share
 * crawlers snapshot those from the HTML bytes before
 * /js/invite-banner.js and invite.js run.
 * The same pass reports a rewritten landing as found: Pages resolves
 * /invite/<code> to the code-less shell through the _redirects rewrite but
 * keeps the not-found status of the path that was asked for, and a crawler
 * drops a 404 before it reads the tags this pass just wrote.
 * public/ stays generic; this is not a site-wide renderer.
 */
import {
  injectLandingFromRequestUrl,
  landingStatus,
  shouldRewriteItunesBanner,
} from './lib/itunes-banner.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!shouldRewriteItunesBanner(url.pathname)) {
    return context.next();
  }
  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return context.next();
  }
  const isHead = method === 'HEAD';
  // Both methods ask for the same thing: the whole document as a GET.
  //
  // HEAD, because the status has to be decided from the body — the marker in it
  // is what tells the landing shell from the site's own 404 page. A HEAD
  // response carries none, and without this the same link would read as found
  // by GET and as dead by the HEAD a link checker sends first.
  //
  // A full document, because this pass rewrites all of it. A partial
  // representation would be injected into a fragment and returned under a
  // Content-Range describing the bytes before the rewrite.
  const response = await context.next(asFullGet(context.request));
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) {
    // Nothing to rewrite. A HEAD still must not carry the body the GET-
    // equivalent came back with.
    return isHead ? bodyless(response, response.status, response.statusText) : response;
  }
  const html = await response.text();
  const injected = injectLandingFromRequestUrl(html, context.request.url);
  const headers = new Headers(response.headers);
  // Everything that described the bytes before the rewrite. A stale validator
  // is worse than none: a conditional request would be answered 304 against a
  // document the client never received. Measured on the deploy: Pages sets
  // neither ETag nor Last-Modified on these paths today, so this is a guard.
  for (const stale of ['content-length', 'etag', 'last-modified', 'content-range']) {
    headers.delete(stale);
  }
  const status = landingStatus(response.status, injected);
  // A promoted status must not keep "Not Found" as its reason phrase.
  const statusText = status === response.status ? response.statusText : '';
  // 204, 205 and 304 must not carry a body. Pairing one with a body throws,
  // which would turn such an answer into a 500 instead of passing it on.
  const sendNoBody = isHead || status === 204 || status === 205 || status === 304;
  return new Response(sendNoBody ? null : injected, { status, statusText, headers });
}

/** Headers that let the answer be something other than the full document. */
const PARTIAL_OR_CONDITIONAL = [
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
  'if-match',
  'if-unmodified-since',
];

/**
 * The same request as a GET for the whole document. Every header that could
 * make the answer something else is dropped: Range would allow 206, the
 * conditional ones 304 or 412. None of those bodies is the landing shell, and
 * the status here is decided from the body. Everything else the client sent is
 * kept.
 *
 * Measured on the deploy with a Range GET, reading the body rather than only
 * the headers: Pages answers with the full document today and no 206, so this
 * is a guard rather than a live fix.
 */
function asFullGet(request) {
  const headers = new Headers(request.headers);
  for (const name of PARTIAL_OR_CONDITIONAL) {
    headers.delete(name);
  }
  try {
    return new Request(request, { method: 'GET', headers });
  } catch {
    // A GET or HEAD carrying a body cannot be re-methoded: the constructor
    // refuses to pair one with GET. Rebuild from the URL instead, which drops
    // the platform's request metadata but keeps the request answerable.
    return new Request(request.url, { method: 'GET', headers });
  }
}

/** The same status and headers, with no body and no stale content-length. */
function bodyless(response, status, statusText) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(null, { status, statusText, headers });
}
