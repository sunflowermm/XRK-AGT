/** Playwright 受控会话；`goto` 默认走 {@link assertUrlSafeForBrowserNavigation}。 */
import playwright from 'playwright';
import { assertUrlSafeForBrowserNavigation } from './nav-ssrf.js';

const BROWSER_TYPES = /** @type {const} */ (['chromium', 'firefox', 'webkit']);

/**
 * @typedef {Object} PlaywrightAgentLaunchOptions
 * @property {'chromium'|'firefox'|'webkit'} [browserType]
 * @property {boolean} [headless]
 * @property {string} [executablePath]
 * @property {number} [launchTimeoutMs]
 * @property {string[]} [launchArgs]
 * @property {Record<string, string>} [extraHTTPHeaders]
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
      extraHTTPHeaders
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

    const context = await browser.newContext(
      extraHTTPHeaders && Object.keys(extraHTTPHeaders).length > 0 ? { extraHTTPHeaders } : {}
    );
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
      await assertUrlSafeForBrowserNavigation(url, ssrfPolicy ?? {});
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
