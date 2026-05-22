/** Playwright 受控会话；goto 默认 SSRF 校验（与 web_fetch 一致） */
import playwright from 'playwright';
import { assertUrlSafeForFetch } from './ssrf-guard.js';
import { DEFAULT_DEVICE_SCALE_FACTOR } from './page-screenshot-enhance.js';

const BROWSER_TYPES = /** @type {const} */ (['chromium', 'firefox', 'webkit']);

/**
 * @typedef {Object} PlaywrightAgentLaunchOptions
 * @property {'chromium'|'firefox'|'webkit'} [browserType]
 * @property {boolean} [headless]
 * @property {string} [executablePath]
 * @property {number} [launchTimeoutMs]
 * @property {string[]} [launchArgs]
 * @property {Record<string, string>} [extraHTTPHeaders]
 * @property {number} [deviceScaleFactor]
 * @property {{ width: number, height: number }} [viewport]
 */

export class PlaywrightAgentSession {
  /**
   * @param {import('playwright').Browser} browser
   * @param {import('playwright').BrowserContext} context
   * @param {import('playwright').Page} page
   */
  constructor(browser, context, page) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    /** @type {{ prepare?: (page: import('playwright').Page) => Promise<void>, apply: (page: import('playwright').Page) => Promise<void>, capture: (page: import('playwright').Page, selector?: string) => Promise<Buffer> } | null} */
    this.screenshotHelper = null;
  }

  /** @param {ReturnType<import('./page-screenshot-enhance.js').createLocalFontScreenshotHelper>} helper */
  attachScreenshotHelper(helper) {
    this.screenshotHelper = helper;
    return this;
  }

  /** @param {PlaywrightAgentLaunchOptions} [options] */
  static async launch(options = {}) {
    const {
      browserType = 'chromium',
      headless = true,
      executablePath,
      launchTimeoutMs = 120_000,
      launchArgs = [],
      extraHTTPHeaders,
      deviceScaleFactor = DEFAULT_DEVICE_SCALE_FACTOR,
      viewport
    } = options;

    if (!BROWSER_TYPES.includes(browserType)) {
      throw new Error(`browserType must be one of: ${BROWSER_TYPES.join(', ')}`);
    }

    const browser = await playwright[browserType].launch({
      headless,
      executablePath: executablePath || undefined,
      args: launchArgs,
      timeout: Math.min(Math.max(launchTimeoutMs, 5_000), 180_000)
    });

    /** @type {import('playwright').BrowserContextOptions} */
    const contextOptions = {};
    if (extraHTTPHeaders && Object.keys(extraHTTPHeaders).length > 0) {
      contextOptions.extraHTTPHeaders = extraHTTPHeaders;
    }
    if (viewport?.width && viewport?.height) {
      contextOptions.viewport = viewport;
    }
    if (Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0) {
      contextOptions.deviceScaleFactor = deviceScaleFactor;
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    return new PlaywrightAgentSession(browser, context, page);
  }

  async goto(url, navOptions = {}) {
    const { waitUntil = 'load', timeoutMs = 60_000, skipSsrfCheck = false, ssrfPolicy } = navOptions;
    if (!skipSsrfCheck) await assertUrlSafeForFetch(url, ssrfPolicy ?? {});
    await this.page.goto(url, { waitUntil, timeout: timeoutMs });
  }

  async title() {
    return this.page.title();
  }

  async textContent() {
    return this.page.locator('body').innerText();
  }

  async screenshot(opts) {
    return this.page.screenshot({ fullPage: false, type: 'png', ...opts });
  }

  async captureRegion(selector = '.content', opts) {
    if (this.screenshotHelper) {
      await this.screenshotHelper.apply(this.page);
      return this.screenshotHelper.capture(this.page, selector);
    }
    const shotOpts = { type: 'png', animations: 'disabled', caret: 'hide', scale: 'device', ...opts };
    return this.page.locator(selector).first().screenshot(shotOpts);
  }

  async gotoAndCapture(url, options = {}) {
    const {
      selector = '.content',
      waitUntil = 'load',
      timeoutMs = 60_000,
      settleMs = 0,
      skipSsrfCheck = false,
      ssrfPolicy
    } = options;
    if (this.screenshotHelper?.prepare) await this.screenshotHelper.prepare(this.page);
    await this.goto(url, { waitUntil, timeoutMs, skipSsrfCheck, ssrfPolicy });
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    return this.captureRegion(selector);
  }

  async regionText(selector = '.content') {
    const loc = this.page.locator(selector).first();
    if (await loc.count()) return loc.innerText();
    return this.textContent();
  }

  /** @template T */
  static async using(options, fn) {
    const session = await PlaywrightAgentSession.launch(options);
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  url() {
    return this.page?.url() ?? '';
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}
