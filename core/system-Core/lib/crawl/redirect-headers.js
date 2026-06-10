/** redirect-headers.ts 移植 */

const CROSS_ORIGIN_REDIRECT_SAFE_HEADERS = new Set([
  'accept', 'accept-encoding', 'accept-language', 'cache-control', 'content-language',
  'content-type', 'if-match', 'if-modified-since', 'if-none-match', 'if-unmodified-since',
  'pragma', 'range', 'user-agent'
]);

export function retainSafeHeadersForCrossOriginRedirect(headers) {
  if (!headers) return headers;
  const incoming = new Headers(headers);
  const safe = {};
  for (const [key, value] of incoming.entries()) {
    if (CROSS_ORIGIN_REDIRECT_SAFE_HEADERS.has(key.toLowerCase())) {
      safe[key] = value;
    }
  }
  return safe;
}

export function dropBodyHeaders(headers) {
  if (!headers) return headers;
  const next = new Headers(headers);
  for (const h of ['content-encoding', 'content-language', 'content-length', 'content-location', 'content-type', 'transfer-encoding']) {
    next.delete(h);
  }
  return next;
}
