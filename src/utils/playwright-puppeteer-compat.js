/**
 * Playwright Page 上的 Puppeteer API 兼容（仅 Playwright 渲染器 / 爬虫会话使用）
 */

/** @param {import('playwright').Page} page */
function applyPuppeteerPageCompat(page) {
  if (!page || page.__xrkPuppeteerCompat) return page;
  page.__xrkPuppeteerCompat = true;

  if (typeof page.setViewport !== 'function' && typeof page.setViewportSize === 'function') {
    page.setViewport = (viewport = {}) => page.setViewportSize(viewport);
  }

  if (typeof page.waitFor !== 'function') {
    page.waitFor = (ms) => page.waitForTimeout(ms);
  }

  return page;
}

/** @param {import('playwright').BrowserContext} context */
function patchBrowserContextCompat(context) {
  if (!context || context.__xrkPuppeteerCompat) return context;
  context.__xrkPuppeteerCompat = true;

  const origNewPage = context.newPage.bind(context);
  context.newPage = async (...args) => applyPuppeteerPageCompat(await origNewPage(...args));

  return context;
}

/** @param {import('playwright').Browser} browser */
export function patchBrowserCompat(browser) {
  if (!browser || browser.__xrkPuppeteerCompat) return browser;
  browser.__xrkPuppeteerCompat = true;

  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => patchBrowserContextCompat(await origNewContext(...args));

  return browser;
}
