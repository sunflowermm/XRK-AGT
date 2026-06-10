/**
 * OpenClaw fetch-guard 移植 — SSRF、DNS pinning、重定向环、方法改写、跨域头剥离
 */
import {
  SsrFBlockedError,
  assertUrlSafeForFetch,
  resolvePinnedHostnameWithPolicy,
  createPinnedDispatcher,
  closeDispatcher,
  resolveSsrFPolicyForUrl
} from './ssrf-policy.js';
import { dropBodyHeaders, retainSafeHeadersForCrossOriginRedirect } from './redirect-headers.js';

const DEFAULT_MAX_REDIRECTS = 3;

function getRedirectVisitKey(url, init) {
  return `${init?.method?.toUpperCase() ?? 'GET'} ${url}`;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function rewriteRedirectInitForMethod(init, status) {
  if (!init) return init;
  const currentMethod = init.method?.toUpperCase() ?? 'GET';
  const shouldForceGet =
    status === 303
      ? currentMethod !== 'GET' && currentMethod !== 'HEAD'
      : (status === 301 || status === 302) && currentMethod === 'POST';
  if (!shouldForceGet) return init;
  return { ...init, method: 'GET', body: undefined, headers: dropBodyHeaders(init.headers) };
}

function rewriteRedirectInitForCrossOrigin(init, allowUnsafeReplay) {
  if (!init || allowUnsafeReplay) return init;
  const currentMethod = init.method?.toUpperCase() ?? 'GET';
  if (currentMethod === 'GET' || currentMethod === 'HEAD') return init;
  return { ...init, body: undefined, headers: dropBodyHeaders(init.headers) };
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ maxRedirects?: number, timeoutMs?: number, ssrfPolicy?: object, pinDns?: boolean, dispatcherPolicy?: object, allowCrossOriginUnsafeRedirectReplay?: boolean, lookupFn?: Function }} [options]
 */
export async function fetchWithSsrFGuard(url, init = {}, options = {}) {
  const maxRedirects =
    typeof options.maxRedirects === 'number' && Number.isFinite(options.maxRedirects)
      ? Math.max(0, Math.floor(options.maxRedirects))
      : DEFAULT_MAX_REDIRECTS;
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
  const ssrfPolicy = options.ssrfPolicy ?? {};
  const pinDns = options.pinDns !== false;

  let currentUrl = url;
  let currentInit = init ? { ...init } : {};
  const visited = new Set([getRedirectVisitKey(currentUrl, currentInit)]);
  let redirectCount = 0;

  while (true) {
    let parsedUrl;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new Error('Invalid URL: must be http or https');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid URL: must be http or https');
    }

    const effectivePolicy = resolveSsrFPolicyForUrl(parsedUrl, ssrfPolicy);
    await assertUrlSafeForFetch(currentUrl, effectivePolicy, options.lookupFn);

    /** @type {import('undici').Dispatcher | undefined} */
    let dispatcher;
    try {
      if (pinDns) {
        const pinned = await resolvePinnedHostnameWithPolicy(parsedUrl.hostname, {
          policy: effectivePolicy,
          lookupFn: options.lookupFn
        });
        dispatcher = createPinnedDispatcher(pinned, options.dispatcherPolicy, timeoutMs);
      }

      const res = await fetch(currentUrl, {
        ...currentInit,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {})
      });

      if (!isRedirectStatus(res.status)) {
        return { response: res, finalUrl: currentUrl };
      }

      const location = res.headers.get('location');
      if (!location) {
        return { response: res, finalUrl: currentUrl };
      }

      redirectCount += 1;
      if (redirectCount > maxRedirects) {
        throw new Error('Too many redirects');
      }

      const nextUrl = new URL(location, parsedUrl).href;
      currentInit = rewriteRedirectInitForMethod(currentInit, res.status) ?? currentInit;

      if (new URL(nextUrl).origin !== parsedUrl.origin) {
        currentInit =
          rewriteRedirectInitForCrossOrigin(
            currentInit,
            options.allowCrossOriginUnsafeRedirectReplay === true
          ) ?? currentInit;
        if (currentInit.headers) {
          currentInit = {
            ...currentInit,
            headers: retainSafeHeadersForCrossOriginRedirect(currentInit.headers)
          };
        }
      }

      const visitKey = getRedirectVisitKey(nextUrl, currentInit);
      if (visited.has(visitKey)) {
        throw new Error('Redirect loop detected');
      }
      visited.add(visitKey);

      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }

      currentUrl = nextUrl;
    } finally {
      if (dispatcher) await closeDispatcher(dispatcher);
    }
  }
}

export { SsrFBlockedError };
