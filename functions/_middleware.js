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
 * drops a 404 before it reads the tags written just above.
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
  // The status has to be decided from the body: the marker in it is what tells
  // the landing shell from the site's own 404 page. A HEAD response carries no
  // body, so HEAD asks for the GET-equivalent and answers with that status and
  // those headers, without the body. Otherwise the same link would read as
  // found by GET and as dead by the HEAD a link checker sends first.
  const response = isHead ? await context.next(asGet(context.request)) : await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) {
    // Nothing to rewrite. A HEAD still must not carry the body the GET-
    // equivalent came back with.
    return isHead ? bodyless(response, response.status, response.statusText) : response;
  }
  const html = await response.text();
  const injected = injectLandingFromRequestUrl(html, context.request.url);
  const headers = new Headers(response.headers);
  // The original length described the bytes before the rewrite.
  headers.delete('content-length');
  const status = landingStatus(response.status, injected);
  // A promoted status must not keep "Not Found" as its reason phrase.
  const statusText = status === response.status ? response.statusText : '';
  return new Response(isHead ? null : injected, { status, statusText, headers });
}

/**
 * The same request as a GET. Range and If-Range are dropped: a HEAD carrying
 * them would otherwise come back as 206 Partial Content, whose body is not the
 * landing shell, so the status would neither be promoted nor mean what the
 * client asked for. Everything else the client sent is kept.
 */
function asGet(request) {
  const headers = new Headers(request.headers);
  headers.delete('range');
  headers.delete('if-range');
  return new Request(request, { method: 'GET', headers });
}

/** The same status and headers, with no body and no stale content-length. */
function bodyless(response, status, statusText) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(null, { status, statusText, headers });
}
