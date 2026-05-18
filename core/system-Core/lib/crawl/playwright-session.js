/** Playwright 受控会话；`goto` 默认走 SSRF 校验（与 web_fetch 一致）。 */
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
 * @property {number} [deviceScaleFactor] 设备像素比（截图清晰度，默认 {@link DEFAULT_DEVICE_SCALE_FACTOR}）
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
    /** @type {import('playwright').Page} */
    this.page = page;
    /** @type {{ apply: (page: import('playwright').Page) => Promise<void>, capture: (page: import('playwright').Page, selector?: string) => Promise<Buffer> } | null} */
    this.screenshotHelper = null;
  }

  /**
   * @param {ReturnType<import('./page-screenshot-enhance.js').createLocalFontScreenshotHelper>} helper
   */
  attachScreenshotHelper(helper) {
    this.screenshotHelper = helper;
    return this;
  }

  /**
   * @param {PlaywrightAgentLaunchOptions} [options]
   * @returns {Promise<PlaywrightAgentSession>}
   */
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

    const launcher = playwright[browserType];
    const browser = await launcher.launch({
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

  /**
   * @param {string} url
   * @param {{
   *   waitUntil?: 'load'|'domcontentloaded'|'networkidle'|'commit',
   *   timeoutMs?: number,
   *   skipSsrfCheck?: boolean,
   *   ssrfPolicy?: { allowPrivateNetwork?: boolean, dangerouslyAllowPrivateNetwork?: boolean }
   * }} [navOptions]
   */
  async goto(url, navOptions = {}) {
    const { waitUntil = 'load', timeoutMs = 60_000, skipSsrfCheck = false, ssrfPolicy } = navOptions;
    if (!skipSsrfCheck) {
      await assertUrlSafeForFetch(url, ssrfPolicy ?? {});
    }
    await this.page.goto(url, { waitUntil, timeout: timeoutMs });
  }

  /** @returns {Promise<string>} */
  async title() {
    return this.page.title();
  }

  /** @returns {Promise<string>} */
  async textContent() {
    const h = await this.page.locator('body').innerText().catch(() => '');
    return h ?? '';
  }

  /**
   * @param {import('playwright').PageScreenshotOptions} [opts]
   * @returns {Promise<Buffer>}
   */
  async screenshot(opts) {
    return this.page.screenshot({ fullPage: false, type: 'png', ...opts });
  }

  /**
   * 区域截图；若已 attachScreenshotHelper 则先应用字体/样式增强
   * @param {string} [selector='.content']
   * @param {import('playwright').PageScreenshotOptions} [opts] 无 helper 时传给 page.screenshot
   */
  async captureRegion(selector = '.content', opts) {
    if (this.screenshotHelper) {
      await this.screenshotHelper.apply(this.page);
      return this.screenshotHelper.capture(this.page, selector);
    }
    const locator = this.page.locator(selector).first();
    const shotOpts = { type: 'png', animations: 'disabled', caret: 'hide', scale: 'device', ...opts };
    return locator.screenshot(shotOpts).catch(() => this.screenshot(shotOpts));
  }

  /**
   * 导航后区域截图；已 attach screenshotHelper 时在 goto 前注册 route
   * @param {string} url
   * @param {{
   *   selector?: string,
   *   waitUntil?: 'load'|'domcontentloaded'|'networkidle'|'commit',
   *   timeoutMs?: number,
   *   settleMs?: number,
   *   skipSsrfCheck?: boolean,
   *   ssrfPolicy?: { allowPrivateNetwork?: boolean, dangerouslyAllowPrivateNetwork?: boolean }
   * }} [options]
   */
  async gotoAndCapture(url, options = {}) {
    const {
      selector = '.content',
      waitUntil = 'load',
      timeoutMs = 60_000,
      settleMs = 0,
      skipSsrfCheck = false,
      ssrfPolicy
    } = options;
    if (this.screenshotHelper?.prepare) {
      await this.screenshotHelper.prepare(this.page);
    }
    await this.goto(url, { waitUntil, timeoutMs, skipSsrfCheck, ssrfPolicy });
    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }
    return this.captureRegion(selector);
  }

  /** @param {string} [selector='.content'] */
  async regionText(selector = '.content') {
    return this.page.locator(selector).first().innerText().catch(() => this.textContent());
  }

  /**
   * 启动会话、执行回调、关闭（避免业务层重复 try/finally）
   * @param {PlaywrightAgentLaunchOptions} options
   * @param {(session: PlaywrightAgentSession) => Promise<T>} fn
   * @template T
   */
  static async using(options, fn) {
    const session = await PlaywrightAgentSession.launch(options);
    try {
      return await fn(session);
    } finally {
      await session.close().catch(() => {});
    }
  }

  /** @returns {string} */
  url() {
    try {
      return this.page?.url() ?? '';
    } catch {
      return '';
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
