/**
 * 浏览器导航 URL 校验，与 `web_fetch` 共用 `ssrf-guard`。
 */
import { assertUrlSafeForFetch, SsrFBlockedError } from '../openclaw-web/ssrf-guard.js';

export { assertUrlSafeForFetch, SsrFBlockedError };

export async function assertUrlSafeForBrowserNavigation(urlString, policy) {
  return assertUrlSafeForFetch(urlString, policy ?? {});
}
