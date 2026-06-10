/**
 * OpenClaw provider-web-search 端点封装 — 受信 / 自托管 SSRF 策略
 */
import { assertUrlSafeForFetch } from './ssrf-policy.js';
import { isPrivateIpAddress } from './ssrf-ip-policy.js';
import { resolvePinnedHostnameWithPolicy } from './ssrf-policy.js';

/**
 * @param {{ url: string, timeoutSeconds?: number, init?: RequestInit, ssrfPolicy?: object, signal?: AbortSignal }} params
 * @param {(response: Response) => Promise<unknown>} handler
 */
export async function withTrustedWebSearchEndpoint(params, handler) {
  const { url, timeoutSeconds = 20, init = {}, ssrfPolicy = {} } = params;
  await assertUrlSafeForFetch(url, ssrfPolicy);
  const signal = params.signal ?? init.signal ?? AbortSignal.timeout(timeoutSeconds * 1000);
  const response = await fetch(url, { ...init, signal });
  return handler(response);
}

/**
 * 自托管实例（SearXNG / 私有 Firecrawl）允许内网解析
 * @param {{ url: string, timeoutSeconds?: number, init?: RequestInit, ssrfPolicy?: object, signal?: AbortSignal }} params
 * @param {(response: Response) => Promise<unknown>} handler
 */
export async function withSelfHostedWebSearchEndpoint(params, handler) {
  return withTrustedWebSearchEndpoint(
    {
      ...params,
      ssrfPolicy: {
        allowPrivateNetwork: true,
        allowRfc2544BenchmarkRange: true,
        ...(params.ssrfPolicy ?? {})
      }
    },
    handler
  );
}

/** @param {Response} response @param {string} label */
export async function throwWebSearchApiError(response, label) {
  const detail = await response.text().catch(() => '');
  throw new Error(`${label} API error (${response.status}): ${detail || response.statusText}`);
}

/**
 * @param {string} baseUrl
 * @param {LookupFn} [lookupFn]
 * @returns {Promise<'selfHosted' | 'strict'>}
 */
export async function validateSelfHostedBaseUrl(baseUrl, lookupFn) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Base URL must be a valid http:// or https:// URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must use http:// or https://.');
  }
  if (parsed.protocol === 'http:') {
    return 'selfHosted';
  }
  try {
    const pinned = await resolvePinnedHostnameWithPolicy(parsed.hostname, {
      lookupFn,
      policy: { allowPrivateNetwork: true, allowRfc2544BenchmarkRange: true }
    });
    const allPrivate = pinned.addresses.every((addr) => isPrivateIpAddress(addr));
    return allPrivate ? 'selfHosted' : 'strict';
  } catch {
    return 'strict';
  }
}
