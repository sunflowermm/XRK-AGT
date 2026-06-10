/**
 * web_search 提供商注册表 — 元数据、凭据检测、auto-detect 顺序
 */
import { getWebSearchProviderScope } from './crawl-config.js';
import { runBraveSearch } from './web-search-brave.js';
import { runDuckDuckGoSearch } from './web-search-duckduckgo.js';
import { runPerplexitySearch } from './web-search-perplexity.js';
import { runExaSearch } from './web-search-exa.js';
import { runTavilySearch } from './web-search-tavily.js';
import { runParallelSearch } from './web-search-parallel.js';
import { runParallelFreeSearch } from './web-search-parallel-free.js';
import { runGeminiSearch } from './web-search-gemini.js';
import { runKimiSearch } from './web-search-kimi.js';
import { runMiniMaxSearch } from './web-search-minimax.js';
import { runFirecrawlSearch } from './web-search-firecrawl.js';
import { runSearxngSearch } from './web-search-searxng.js';
import { runOllamaSearch } from './web-search-ollama.js';

/** @typedef {{ id: string, label: string, hint?: string, requiresCredential: boolean, credentialField?: string, autoDetectOrder: number, run: Function }} WebSearchProviderEntry */

/** @type {WebSearchProviderEntry[]} */
export const WEB_SEARCH_PROVIDERS = [
  {
    id: 'perplexity',
    label: 'Perplexity Search',
    hint: 'aistream.crawl.webSearch.perplexity.apiKey / openRouterApiKey',
    requiresCredential: true,
    autoDetectOrder: 50,
    run: runPerplexitySearch
  },
  {
    id: 'brave',
    label: 'Brave Search',
    hint: 'aistream.crawl.webSearch.brave.apiKey',
    requiresCredential: true,
    autoDetectOrder: 55,
    run: runBraveSearch
  },
  {
    id: 'exa',
    label: 'Exa Search',
    hint: 'aistream.crawl.webSearch.exa.apiKey',
    requiresCredential: true,
    autoDetectOrder: 56,
    run: runExaSearch
  },
  {
    id: 'tavily',
    label: 'Tavily Search',
    hint: 'aistream.crawl.webSearch.tavily.apiKey',
    requiresCredential: true,
    autoDetectOrder: 57,
    run: runTavilySearch
  },
  {
    id: 'parallel',
    label: 'Parallel Search',
    hint: 'aistream.crawl.webSearch.parallel.apiKey',
    requiresCredential: true,
    autoDetectOrder: 58,
    run: runParallelSearch
  },
  {
    id: 'parallel-free',
    label: 'Parallel Search (Free MCP)',
    hint: 'aistream.crawl.webSearch.parallelFree.url',
    requiresCredential: false,
    autoDetectOrder: 76,
    run: runParallelFreeSearch
  },
  {
    id: 'gemini',
    label: 'Gemini Google Search',
    hint: 'aistream.crawl.webSearch.gemini.apiKey',
    requiresCredential: true,
    autoDetectOrder: 59,
    run: runGeminiSearch
  },
  {
    id: 'kimi',
    label: 'Kimi / Moonshot Search',
    hint: 'aistream.crawl.webSearch.kimi.apiKey',
    requiresCredential: true,
    autoDetectOrder: 60,
    run: runKimiSearch
  },
  {
    id: 'minimax',
    label: 'MiniMax Search',
    hint: 'aistream.crawl.webSearch.minimax.apiKey',
    requiresCredential: true,
    autoDetectOrder: 65,
    run: runMiniMaxSearch
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl Search',
    hint: 'aistream.crawl.webSearch.firecrawl.apiKey',
    requiresCredential: true,
    autoDetectOrder: 70,
    run: runFirecrawlSearch
  },
  {
    id: 'ollama',
    label: 'Ollama Web Search',
    hint: 'aistream.crawl.webSearch.ollama.baseUrl',
    requiresCredential: false,
    autoDetectOrder: 110,
    run: runOllamaSearch
  },
  {
    id: 'searxng',
    label: 'SearXNG Search',
    hint: 'aistream.crawl.webSearch.searxng.baseUrl',
    requiresCredential: true,
    credentialField: 'baseUrl',
    autoDetectOrder: 200,
    run: runSearxngSearch
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    hint: '无需凭据（HTML 抓取）',
    requiresCredential: false,
    autoDetectOrder: 900,
    run: runDuckDuckGoSearch
  }
];

const PROVIDER_BY_ID = new Map(WEB_SEARCH_PROVIDERS.map((p) => [p.id, p]));

export function getWebSearchProvider(id) {
  return PROVIDER_BY_ID.get(String(id || '').toLowerCase());
}

/** @param {WebSearchProviderEntry} provider @param {object} [runtime] */
export function isWebSearchProviderConfigured(provider, runtime = {}) {
  if (!provider.requiresCredential) return true;
  const scoped = getWebSearchProviderScope(runtime, provider.id);
  if (provider.credentialField === 'baseUrl') {
    return Boolean(scoped?.baseUrl?.trim?.());
  }
  return Boolean(scoped?.apiKey?.trim?.());
}

/** 有凭据的提供商优先，keyless 最后 */
export function resolveAutoDetectProviderId(runtime = {}) {
  const explicit = runtime.provider?.trim?.() || '';
  if (explicit && getWebSearchProvider(explicit)) return explicit;

  const sorted = [...WEB_SEARCH_PROVIDERS].sort((a, b) => a.autoDetectOrder - b.autoDetectOrder);
  for (const provider of sorted) {
    if (!provider.requiresCredential) continue;
    if (isWebSearchProviderConfigured(provider, runtime)) return provider.id;
  }
  for (const provider of sorted) {
    if (!provider.requiresCredential) return provider.id;
  }
  return 'parallel-free';
}

export function listWebSearchProviderMeta(runtime = {}) {
  return WEB_SEARCH_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    hint: p.hint,
    requiresCredential: p.requiresCredential,
    configured: isWebSearchProviderConfigured(p, runtime),
    autoDetectOrder: p.autoDetectOrder
  }));
}
