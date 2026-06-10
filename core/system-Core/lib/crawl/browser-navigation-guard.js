/**
 * OpenClaw navigation-guard 移植 — 浏览器导航 SSRF、重定向链、hash-only 检测
 */
import { isIP } from 'node:net';
import {
  SsrFBlockedError,
  assertUrlSafeForFetch,
  resolvePinnedHostnameWithPolicy,
  isPrivateNetworkAllowedByPolicy,
  matchesHostnameAllowlist,
  normalizeHostnameAllowlist
} from './ssrf-policy.js';
import { normalizeHostname } from './ssrf-ip-policy.js';

export { SsrFBlockedError };

export class InvalidBrowserNavigationUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidBrowserNavigationUrlError';
  }
}

const NETWORK_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_NON_NETWORK = new Set(['about:blank']);

export function isPolicyDenyNavigationError(err) {
  return err instanceof SsrFBlockedError || err instanceof InvalidBrowserNavigationUrlError;
}

function isIpLiteralHostname(hostname) {
  return isIP(normalizeHostname(hostname)) !== 0;
}

function isExplicitlyAllowedBrowserHostname(hostname, ssrfPolicy) {
  const normalized = normalizeHostname(hostname);
  const exact = (ssrfPolicy?.allowedHostnames ?? []).map(normalizeHostname);
  if (exact.includes(normalized)) return true;
  const allowlist = normalizeHostnameAllowlist(ssrfPolicy?.hostnameAllowlist);
  return allowlist.length > 0 && matchesHostnameAllowlist(normalized, allowlist);
}

export function didCrossDocumentUrlChange(page, previousUrl) {
  const currentUrl = page.url();
  if (currentUrl === previousUrl) return false;
  try {
    const prev = new URL(previousUrl);
    const curr = new URL(currentUrl);
    if (prev.origin === curr.origin && prev.pathname === curr.pathname && prev.search === curr.search) {
      return false;
    }
    return true;
  } catch {
    return currentUrl !== previousUrl;
  }
}

export function isHashOnlyNavigation(currentUrl, previousUrl) {
  if (currentUrl === previousUrl) return false;
  try {
    const prev = new URL(previousUrl);
    const curr = new URL(currentUrl);
    return prev.origin === curr.origin && prev.pathname === curr.pathname && prev.search === curr.search;
  } catch {
    return false;
  }
}

/**
 * @param {string | { url: string, ssrfPolicy?: object, browserProxyMode?: string, lookupFn?: Function }} arg
 */
export async function assertBrowserNavigationAllowed(arg, legacyPolicy) {
  const opts = typeof arg === 'string' ? { url: arg, ssrfPolicy: legacyPolicy ?? {} } : arg;
  const rawUrl = String(opts.url || '').trim();
  if (!rawUrl) throw new InvalidBrowserNavigationUrlError('url is required');

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InvalidBrowserNavigationUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) {
    if (SAFE_NON_NETWORK.has(parsed.href)) return;
    throw new InvalidBrowserNavigationUrlError(
      `Navigation blocked: unsupported protocol "${parsed.protocol}"`
    );
  }

  if (
    opts.browserProxyMode === 'explicit-browser-proxy' &&
    !isPrivateNetworkAllowedByPolicy(opts.ssrfPolicy)
  ) {
    throw new InvalidBrowserNavigationUrlError(
      'Navigation blocked: strict browser SSRF policy cannot be enforced while browser profile is proxy-routed'
    );
  }

  const policy = opts.ssrfPolicy ?? {};
  if (
    policy.dangerouslyAllowPrivateNetwork === false &&
    !isPrivateNetworkAllowedByPolicy(policy) &&
    !isIpLiteralHostname(parsed.hostname) &&
    !isExplicitlyAllowedBrowserHostname(parsed.hostname, policy)
  ) {
    await assertUrlSafeForFetch(rawUrl, policy, opts.lookupFn);
    return;
  }

  await resolvePinnedHostnameWithPolicy(parsed.hostname, { policy, lookupFn: opts.lookupFn });
}

export async function assertBrowserNavigationResultAllowed(arg, legacyPolicy) {
  const opts = typeof arg === 'string' ? { url: arg, ssrfPolicy: legacyPolicy ?? {} } : arg;
  const rawUrl = String(opts.url ?? '').trim();
  if (!rawUrl) return;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (NETWORK_PROTOCOLS.has(parsed.protocol) || SAFE_NON_NETWORK.has(parsed.href)) {
    await assertBrowserNavigationAllowed(opts);
  }
}

/** @param {import('playwright').Page} page */
export async function assertBrowserNavigationResultAllowedForPage(page, ssrfPolicy = {}) {
  await assertBrowserNavigationResultAllowed({ url: page.url(), ssrfPolicy });
}

/**
 * Playwright route 拦截导航请求（OpenClaw gotoPageWithNavigationGuard 精简）
 * @param {import('playwright').Page} page
 */
export async function gotoWithNavigationGuard(page, url, opts = {}) {
  const { timeoutMs = 60_000, ssrfPolicy = {}, onBlocked } = opts;
  let blockedError = null;

  const handler = async (route, request) => {
    if (blockedError) {
      await route.abort().catch(() => {});
      return;
    }
    const isMainFrame = request.frame() === page.mainFrame();
    const isDoc =
      request.isNavigationRequest?.() ||
      request.resourceType() === 'document';
    if (!isMainFrame && !isDoc) {
      await route.continue().catch(() => {});
      return;
    }
    try {
      await assertBrowserNavigationAllowed({ url: request.url(), ssrfPolicy });
    } catch (err) {
      if (isPolicyDenyNavigationError(err)) {
        if (isMainFrame) blockedError = err;
        await route.abort().catch(() => {});
        return;
      }
      throw err;
    }
    await route.continue().catch(() => {});
  };

  await page.route('**', handler);
  try {
    const response = await page.goto(url, { timeout: timeoutMs });
    if (blockedError) throw blockedError;
    await assertBrowserNavigationResultAllowedForPage(page, ssrfPolicy);
    return response;
  } catch (err) {
    if (blockedError) {
      if (typeof onBlocked === 'function') await onBlocked(err);
      throw blockedError;
    }
    throw err;
  } finally {
    await page.unroute('**', handler).catch(() => {});
  }
}
