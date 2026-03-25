/**
 * OpenClaw web-fetch.ts 行为移植：SSRF + 手动重定向 + Readability/基础 HTML + 包裹 + 缓存 + Firecrawl 可选
 */
import { SsrFBlockedError, assertUrlSafeForFetch } from './ssrf-guard.js';
import { wrapExternalContent, wrapWebContent } from './external-content-wrap.js';
import {
  extractBasicHtmlContent,
  extractReadableContent,
  htmlToMarkdown,
  markdownToText,
  truncateText
} from './web-fetch-utils.js';
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  writeCache
} from './web-shared.js';

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_RESPONSE_BYTES_MIN = 32_000;
const FETCH_MAX_RESPONSE_BYTES_MAX = 10_000_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_ERROR_MAX_CHARS = 4_000;
const DEFAULT_ERROR_MAX_BYTES = 64_000;
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172_800_000;
const DEFAULT_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const FETCH_CACHE = new Map();

const WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD = wrapWebContent('', 'web_fetch').length;
const WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD = wrapExternalContent('', {
  source: 'web_fetch',
  includeWarning: false
}).length;

function resolveMaxChars(value, fallback, cap) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(100, Math.floor(parsed));
  return Math.min(clamped, cap);
}

function resolveMaxRedirects(value, fallback) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.floor(parsed));
}

function looksLikeHtml(value) {
  const trimmed = value.trimStart();
  if (!trimmed) return false;
  const head = trimmed.slice(0, 256).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function formatWebFetchErrorDetail(params) {
  const { detail, contentType, maxChars } = params;
  if (!detail) return '';
  let text = detail;
  const contentTypeLower = contentType?.toLowerCase();
  if (contentTypeLower?.includes('text/html') || looksLikeHtml(detail)) {
    const rendered = htmlToMarkdown(detail);
    const withTitle = rendered.title ? `${rendered.title}\n${rendered.text}` : rendered.text;
    text = markdownToText(withTitle);
  }
  const truncated = truncateText(text.trim(), maxChars);
  return truncated.text;
}

function wrapWebFetchField(value) {
  if (!value) return value;
  return wrapExternalContent(value, { source: 'web_fetch', includeWarning: false });
}

function wrapWebFetchContent(value, maxChars) {
  if (maxChars <= 0) {
    return { text: '', truncated: true, rawLength: 0, wrappedLength: 0 };
  }
  const includeWarning = maxChars >= WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD;
  const wrapperOverhead = includeWarning
    ? WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD
    : WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD;
  if (wrapperOverhead > maxChars) {
    const minimal = includeWarning
      ? wrapWebContent('', 'web_fetch')
      : wrapExternalContent('', { source: 'web_fetch', includeWarning: false });
    const truncatedWrapper = truncateText(minimal, maxChars);
    return {
      text: truncatedWrapper.text,
      truncated: true,
      rawLength: 0,
      wrappedLength: truncatedWrapper.text.length
    };
  }
  const maxInner = Math.max(0, maxChars - wrapperOverhead);
  let truncated = truncateText(value, maxInner);
  let wrappedText = includeWarning
    ? wrapWebContent(truncated.text, 'web_fetch')
    : wrapExternalContent(truncated.text, { source: 'web_fetch', includeWarning: false });

  if (wrappedText.length > maxChars) {
    const excess = wrappedText.length - maxChars;
    const adjustedMaxInner = Math.max(0, maxInner - excess);
    truncated = truncateText(value, adjustedMaxInner);
    wrappedText = includeWarning
      ? wrapWebContent(truncated.text, 'web_fetch')
      : wrapExternalContent(truncated.text, { source: 'web_fetch', includeWarning: false });
  }

  return {
    text: wrappedText,
    truncated: truncated.truncated,
    rawLength: truncated.text.length,
    wrappedLength: wrappedText.length
  };
}

function normalizeContentType(value) {
  if (!value) return undefined;
  const [raw] = value.split(';');
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function resolveFirecrawlEndpoint(baseUrl) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  try {
    const url = new URL(trimmed);
    if (url.pathname && url.pathname !== '/') return url.toString();
    url.pathname = '/v2/scrape';
    return url.toString();
  } catch {
    return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  }
}

async function fetchFirecrawlContent(params) {
  const endpoint = resolveFirecrawlEndpoint(params.baseUrl);
  const body = {
    url: params.url,
    formats: ['markdown'],
    onlyMainContent: params.onlyMainContent,
    timeout: params.timeoutSeconds * 1000,
    maxAge: params.maxAgeMs,
    proxy: params.proxy,
    storeInCache: params.storeInCache
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout((params.timeoutSeconds + 5) * 1000)
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok || payload?.success === false) {
    const detail = payload?.error ?? '';
    throw new Error(`Firecrawl fetch failed (${res.status}): ${detail || res.statusText}`.trim());
  }

  const data = payload?.data ?? {};
  const rawText =
    typeof data.markdown === 'string'
      ? data.markdown
      : typeof data.content === 'string'
        ? data.content
        : '';
  const text = params.extractMode === 'text' ? markdownToText(rawText) : rawText;
  return {
    text,
    title: data.metadata?.title,
    finalUrl: data.metadata?.sourceURL,
    status: data.metadata?.statusCode,
    warning: payload?.warning
  };
}

function buildFirecrawlWebFetchPayload(params) {
  const wrapped = wrapWebFetchContent(params.firecrawl.text, params.maxChars);
  const wrappedTitle = params.firecrawl.title ? wrapWebFetchField(params.firecrawl.title) : undefined;
  return {
    url: params.rawUrl,
    finalUrl: params.firecrawl.finalUrl || params.finalUrlFallback,
    status: params.firecrawl.status ?? params.statusFallback,
    contentType: 'text/markdown',
    title: wrappedTitle,
    extractMode: params.extractMode,
    extractor: 'firecrawl',
    externalContent: {
      untrusted: true,
      source: 'web_fetch',
      wrapped: true
    },
    truncated: wrapped.truncated,
    length: wrapped.wrappedLength,
    rawLength: wrapped.rawLength,
    wrappedLength: wrapped.wrappedLength,
    fetchedAt: new Date().toISOString(),
    tookMs: params.tookMs,
    text: wrapped.text,
    warning: wrapWebFetchField(params.firecrawl.warning)
  };
}

async function fetchWithManualRedirects(url, init, maxRedirects, timeoutMs) {
  let current = url;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  for (let i = 0; i <= maxRedirects; i++) {
    await assertUrlSafeForFetch(current);

    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: timeoutSignal
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return { response: res, finalUrl: current };
      }
      try {
        current = new URL(loc, current).href;
      } catch {
        return { response: res, finalUrl: current };
      }
      continue;
    }

    return { response: res, finalUrl: current };
  }

  throw new Error('Too many redirects');
}

/** 构建 web_fetch 运行时参数（默认值 + 环境变量）。 */
export function buildWebFetchRuntime() {
  const maxCharsCap = DEFAULT_FETCH_MAX_CHARS;

  let maxResponseBytes = DEFAULT_FETCH_MAX_RESPONSE_BYTES;
  maxResponseBytes = Math.min(
    FETCH_MAX_RESPONSE_BYTES_MAX,
    Math.max(FETCH_MAX_RESPONSE_BYTES_MIN, maxResponseBytes)
  );

  const apiKey =
    (typeof process.env.FIRECRAWL_API_KEY === 'string' && process.env.FIRECRAWL_API_KEY.trim()) ||
    undefined;
  const firecrawlEnabled = Boolean(apiKey);

  return {
    readabilityEnabled: true,
    maxCharsCap,
    maxResponseBytes,
    maxRedirects: resolveMaxRedirects(undefined, DEFAULT_FETCH_MAX_REDIRECTS),
    timeoutSeconds: resolveTimeoutSeconds(undefined, DEFAULT_TIMEOUT_SECONDS),
    cacheTtlMs: resolveCacheTtlMs(undefined, DEFAULT_CACHE_TTL_MINUTES),
    userAgent: DEFAULT_FETCH_USER_AGENT,
    firecrawlEnabled,
    firecrawlApiKey: apiKey,
    firecrawlBaseUrl:
      typeof process.env.FIRECRAWL_BASE_URL === 'string' && process.env.FIRECRAWL_BASE_URL.trim()
        ? process.env.FIRECRAWL_BASE_URL.trim()
        : DEFAULT_FIRECRAWL_BASE_URL,
    firecrawlOnlyMainContent: true,
    firecrawlMaxAgeMs: DEFAULT_FIRECRAWL_MAX_AGE_MS,
    firecrawlProxy: 'auto',
    firecrawlStoreInCache: true,
    firecrawlTimeoutSeconds: resolveTimeoutSeconds(undefined, DEFAULT_TIMEOUT_SECONDS)
  };
}

async function tryFirecrawlFallback(params) {
  if (!params.firecrawlEnabled || !params.firecrawlApiKey) return null;
  try {
    return await fetchFirecrawlContent({
      url: params.url,
      extractMode: params.extractMode,
      apiKey: params.firecrawlApiKey,
      baseUrl: params.firecrawlBaseUrl,
      onlyMainContent: params.firecrawlOnlyMainContent,
      maxAgeMs: params.firecrawlMaxAgeMs,
      proxy: params.firecrawlProxy,
      storeInCache: params.firecrawlStoreInCache,
      timeoutSeconds: params.firecrawlTimeoutSeconds
    });
  } catch {
    return null;
  }
}

async function maybeFetchFirecrawlWebFetchPayload(params) {
  const firecrawl = await tryFirecrawlFallback({
    url: params.urlToFetch,
    extractMode: params.extractMode,
    firecrawlEnabled: params.firecrawlEnabled,
    firecrawlApiKey: params.firecrawlApiKey,
    firecrawlBaseUrl: params.firecrawlBaseUrl,
    firecrawlOnlyMainContent: params.firecrawlOnlyMainContent,
    firecrawlMaxAgeMs: params.firecrawlMaxAgeMs,
    firecrawlProxy: params.firecrawlProxy,
    firecrawlStoreInCache: params.firecrawlStoreInCache,
    firecrawlTimeoutSeconds: params.firecrawlTimeoutSeconds
  });
  if (!firecrawl?.text) return null;

  const payload = buildFirecrawlWebFetchPayload({
    firecrawl: {
      text: firecrawl.text,
      title: firecrawl.title,
      finalUrl: firecrawl.finalUrl,
      status: firecrawl.status,
      warning: firecrawl.warning
    },
    rawUrl: params.url,
    finalUrlFallback: params.finalUrlFallback,
    statusFallback: params.statusFallback,
    extractMode: params.extractMode,
    maxChars: params.maxChars,
    tookMs: params.tookMs
  });
  writeCache(FETCH_CACHE, params.cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export async function runWebFetch(params) {
  const cacheKey = normalizeCacheKey(
    `fetch:${params.url}:${params.extractMode}:${params.maxChars}`
  );
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    throw new Error('Invalid URL: must be http or https');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid URL: must be http or https');
  }

  const start = Date.now();
  const timeoutMs = params.timeoutSeconds * 1000;
  let res;
  let finalUrl = params.url;

  try {
    const out = await fetchWithManualRedirects(
      params.url,
      {
        headers: {
          Accept: 'text/markdown, text/html;q=0.9, */*;q=0.1',
          'User-Agent': params.userAgent,
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      params.maxRedirects,
      timeoutMs
    );
    res = out.response;
    finalUrl = out.finalUrl;
  } catch (error) {
    if (error instanceof SsrFBlockedError) throw error;
    const payload = await maybeFetchFirecrawlWebFetchPayload({
      ...params,
      urlToFetch: finalUrl,
      finalUrlFallback: finalUrl,
      statusFallback: 200,
      cacheKey,
      tookMs: Date.now() - start
    });
    if (payload) return payload;
    throw error;
  }

  try {
    if (!res.ok) {
      const payload = await maybeFetchFirecrawlWebFetchPayload({
        ...params,
        urlToFetch: params.url,
        finalUrlFallback: finalUrl,
        statusFallback: res.status,
        cacheKey,
        tookMs: Date.now() - start
      });
      if (payload) return payload;

      const rawDetailResult = await readResponseText(res, { maxBytes: DEFAULT_ERROR_MAX_BYTES });
      const rawDetail = rawDetailResult.text;
      const detail = formatWebFetchErrorDetail({
        detail: rawDetail,
        contentType: res.headers.get('content-type'),
        maxChars: DEFAULT_ERROR_MAX_CHARS
      });
      const wrappedDetail = wrapWebFetchContent(detail || res.statusText, DEFAULT_ERROR_MAX_CHARS);
      throw new Error(`Web fetch failed (${res.status}): ${wrappedDetail.text}`);
    }

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const normalizedContentType = normalizeContentType(contentType) ?? 'application/octet-stream';
    const bodyResult = await readResponseText(res, { maxBytes: params.maxResponseBytes });
    const body = bodyResult.text;
    const responseTruncatedWarning = bodyResult.truncated
      ? `Response body truncated after ${params.maxResponseBytes} bytes.`
      : undefined;

    let title;
    let extractor = 'raw';
    let text = body;

    if (contentType.includes('text/markdown')) {
      extractor = 'cf-markdown';
      if (params.extractMode === 'text') {
        text = markdownToText(body);
      }
    } else if (contentType.includes('text/html')) {
      if (params.readabilityEnabled) {
        const readable = await extractReadableContent({
          html: body,
          url: finalUrl,
          extractMode: params.extractMode
        });
        if (readable?.text) {
          text = readable.text;
          title = readable.title;
          extractor = 'readability';
        } else {
          const fc = await tryFirecrawlFallback({ ...params, url: finalUrl });
          if (fc?.text) {
            text = fc.text;
            title = fc.title;
            extractor = 'firecrawl';
          } else {
            const basic = await extractBasicHtmlContent({
              html: body,
              extractMode: params.extractMode
            });
            if (basic?.text) {
              text = basic.text;
              title = basic.title;
              extractor = 'raw-html';
            } else {
              throw new Error(
                'Web fetch extraction failed: Readability, Firecrawl, and basic HTML cleanup returned no content.'
              );
            }
          }
        }
      } else {
        const fc = await tryFirecrawlFallback({ ...params, url: finalUrl });
        if (fc?.text) {
          text = fc.text;
          title = fc.title;
          extractor = 'firecrawl';
        } else {
          throw new Error('Web fetch extraction failed: Readability disabled and Firecrawl unavailable.');
        }
      }
    } else if (contentType.includes('application/json')) {
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
        extractor = 'json';
      } catch {
        text = body;
        extractor = 'raw';
      }
    }

    const wrapped = wrapWebFetchContent(text, params.maxChars);
    const wrappedTitle = title ? wrapWebFetchField(title) : undefined;
    const wrappedWarning = wrapWebFetchField(responseTruncatedWarning);
    const payload = {
      url: params.url,
      finalUrl,
      status: res.status,
      contentType: normalizedContentType,
      title: wrappedTitle,
      extractMode: params.extractMode,
      extractor,
      externalContent: {
        untrusted: true,
        source: 'web_fetch',
        wrapped: true
      },
      truncated: wrapped.truncated,
      length: wrapped.wrappedLength,
      rawLength: wrapped.rawLength,
      wrappedLength: wrapped.wrappedLength,
      fetchedAt: new Date().toISOString(),
      tookMs: Date.now() - start,
      text: wrapped.text,
      warning: wrappedWarning
    };
    writeCache(FETCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  } finally {
    // native fetch: drain if needed
  }
}

export { DEFAULT_FETCH_MAX_CHARS, FETCH_CACHE };
