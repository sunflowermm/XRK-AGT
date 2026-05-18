/**
 * 爬虫 / 外联抓取统一入口（HTTP、SSRF、web_fetch、Playwright、增强截图）
 */
export { fetchWithPolicy } from '../net/fetcher.js';
export { SsrFBlockedError, assertUrlSafeForFetch, isPrivateOrReservedIpv4, isBlockedIpv6 } from './ssrf-guard.js';
export {
  buildWebFetchRuntime,
  runWebFetch,
  DEFAULT_FETCH_MAX_CHARS,
  FETCH_CACHE
} from './web-fetch-executor.js';
export {
  htmlToMarkdown,
  markdownToText,
  truncateText,
  extractBasicHtmlContent,
  extractReadableContent
} from './web-fetch-utils.js';
export { PlaywrightAgentSession } from './playwright-session.js';
export {
  createLocalFontScreenshotHelper,
  DEFAULT_DEVICE_SCALE_FACTOR,
  DOM_TWEAK_LABEL_COLON_HALF
} from './page-screenshot-enhance.js';

export { assertUrlSafeForFetch as assertUrlSafeForBrowserNavigation } from './ssrf-guard.js';
