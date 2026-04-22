import cfg from '#infrastructure/config/config.js';
import { ProxyAgent } from 'undici';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeTimeoutMs(v, fallback) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallback;
}

function getDefaultProxyUrl() {
  // 约定：优先读取 server.yaml 的 outbound.proxy；未配置则不启用
  const p = cfg?.server?.outbound?.proxy;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}

/**
 * 统一外联请求：超时 + 简单重试 + 可选代理（undici ProxyAgent）
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number, retries?: number, retryDelayMs?: number, proxyUrl?: string|null }} options
 */
export async function fetchWithPolicy(url, options = {}) {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs, 15_000);
  const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 1;
  const retryDelayMs = normalizeTimeoutMs(options.retryDelayMs, 500);
  const proxyUrl = Object.hasOwn(options, 'proxyUrl') ? options.proxyUrl : getDefaultProxyUrl();

  const base = { ...options };
  delete base.timeoutMs;
  delete base.retries;
  delete base.retryDelayMs;
  delete base.proxyUrl;

  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...base,
        dispatcher,
        signal: base.signal || AbortSignal.timeout(timeoutMs)
      });
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

