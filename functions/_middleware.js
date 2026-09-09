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
  const response = await context.next();
  const method = context.request.method;
  const type = response.headers.get('content-type') || '';
  // HEAD is handled alongside GET: it has to answer with the same status as
  // GET would, and it is what a link checker sends first. Its response carries
  // no body, so it never gets one back.
  if ((method !== 'GET' && method !== 'HEAD') || !type.includes('text/html')) {
    return response;
  }
  const html = await response.text();
  const injected = injectLandingFromRequestUrl(html, context.request.url);
  const headers = new Headers(response.headers);
  // The original length described the bytes before the rewrite.
  headers.delete('content-length');
  // A HEAD response whose body the platform withheld cannot be told apart from
  // the site's own 404 page, so it keeps the status it came with rather than
  // being promoted on the strength of its path alone.
  const status = landingStatus(response.status, injected);
  return new Response(method === 'HEAD' ? null : injected, {
    status,
    // A promoted status must not keep "Not Found" as its reason phrase.
    statusText: status === response.status ? response.statusText : '',
    headers,
  });
}
