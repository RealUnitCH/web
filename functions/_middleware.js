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
  // A partial answer cannot be rewritten: the body is a fragment and the range
  // metadata would stop matching it. Range is stripped above, so this only ever
  // fires for an origin that answers 206 unasked.
  if (response.status === 206) {
    return isHead ? bodyless(response, response.status, response.statusText) : response;
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) {
    // Nothing to rewrite. Note that the request was already stripped of Range
    // and the conditional headers before we could know that — under these
    // paths only HTML is served, and shouldRewriteItunesBanner keeps the asset
    // extensions out, so no caller loses a partial answer it could have had.
    // A HEAD still must not carry the body the GET-equivalent came back with.
    return isHead ? bodyless(response, response.status, response.statusText) : response;
  }
  const html = await response.text();
  const injected = injectLandingFromRequestUrl(html, context.request.url);
  const headers = new Headers(response.headers);
  // The headers that rewriting the representation invalidates or makes
  // unreliable: the length, the content coding, both validators, the range
  // metadata and the integrity digests of RFC 9530 and its predecessors. A
  // stale validator is worse than none — a conditional request would be
  // answered 304 against a document the client never received — and a body
  // labelled gzip that is not gzip does not render at all. The body handed on
  // from here is always the decoded, rewritten string.
  //
  // Content-Encoding goes because response.text() decoded the body: whatever
  // the origin declared, what leaves here is plain text. Whether the header
  // was on the object at all is a separate question — the gzip visible on the
  // deploy is applied by the edge after this Function — and deleting a header
  // that was never there costs nothing.
  //
  // Measured on the deploy: ETag and Last-Modified are not set on these paths
  // today, so those two are a guard rather than a live fix.
  for (const stale of [
    'content-length',
    'content-encoding',
    'etag',
    'last-modified',
    'content-range',
    'content-digest',
    'repr-digest',
    'digest',
    'content-md5',
  ]) {
    headers.delete(stale);
  }
  // response.text() decodes as UTF-8 and a string body is encoded as UTF-8, so
  // the answer is UTF-8 whatever the origin declared.
  headers.set('content-type', 'text/html; charset=utf-8');
  const status = landingStatus(response.status, injected);
  // A promoted status must not keep "Not Found" as its reason phrase.
  const statusText = status === response.status ? response.statusText : '';
  // 204, 205 and 304 must not carry a body. Pairing one with a body throws,
  // which would turn such an answer into a 500 instead of passing it on.
  const sendNoBody = isHead || status === 204 || status === 205 || status === 304;
  return new Response(sendNoBody ? null : injected, { status, statusText, headers });
}

/**
 * The request headers RFC 9110 defines as able to turn the answer into
 * something other than the current full representation: 206 for the first two,
 * 304 or 412 for the rest.
 */
const PARTIAL_OR_CONDITIONAL = [
  'range',
  'if-range',
  'if-none-match',
  'if-modified-since',
  'if-match',
  'if-unmodified-since',
];

/**
 * The same request as a GET for the whole document. The six request headers
 * that RFC 9110 defines as able to change the answer into something other than
 * the current full representation are dropped: Range and If-Range would allow
 * 206, the four conditional ones 304 or 412. None of those bodies is the
 * landing shell, and the status here is decided from the body. Everything else
 * the client sent is kept — except in the body-carrying fallback below, which
 * also drops the body, the headers that described it, and the request metadata
 * that cannot be rebuilt from a URL.
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
  if (request.body === null) {
    return new Request(request, { method: 'GET', headers });
  }
  // A GET or HEAD carrying a body cannot be re-methoded: the constructor
  // refuses to pair one with GET. Rebuild from the URL instead, which drops the
  // platform's request metadata but keeps the request answerable. The headers
  // that described that body go with it, or the new request would announce one
  // it does not carry.
  //
  // Asked rather than caught, so that any other constructor failure still
  // surfaces instead of being quietly rerouted through here.
  headers.delete('content-length');
  headers.delete('content-type');
  return new Request(request.url, { method: 'GET', headers });
}

/**
 * The same status and headers with the body left off. Nothing was rewritten on
 * the paths that reach here, so every header still describes what the origin
 * sent — Content-Length included, which RFC 9110 wants a HEAD to carry as the
 * GET would have.
 */
function bodyless(response, status, statusText) {
  return new Response(null, { status, statusText, headers: new Headers(response.headers) });
}
