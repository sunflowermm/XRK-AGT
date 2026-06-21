/**
 * Playwright 浏览器启动 + Puppeteer API 兼容（setViewport 等）
 * 仅 Playwright 路径使用；Puppeteer 渲染器走原生 API，勿调用本模块。
 */

/** @param {import('playwright').Page} page */
function applyPuppeteerPageCompat(page) {
  if (!page || page.__xrkPuppeteerCompat) return page;
  page.__xrkPuppeteerCompat = true;
  if (typeof page.setViewport !== 'function' && typeof page.setViewportSize === 'function') {
    page.setViewport = (viewport = {}) => page.setViewportSize(viewport);
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
function patchBrowserCompat(browser) {
  if (!browser || browser.__xrkPuppeteerCompat) return browser;
  browser.__xrkPuppeteerCompat = true;
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => patchBrowserContextCompat(await origNewContext(...args));
  return browser;
}

/** @param {import('playwright')} pw @param {string} type @param {object} options */
export async function launchPlaywrightBrowser(pw, type, options) {
  return patchBrowserCompat(await pw[type].launch(options));
}

/** @param {import('playwright')} pw @param {string} type @param {string} wsEndpoint @param {object} [options] */
export async function connectPlaywrightBrowser(pw, type, wsEndpoint, options = {}) {
  return patchBrowserCompat(await pw[type].connect(wsEndpoint, options));
}
