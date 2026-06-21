import BrowserRendererBase from "#infrastructure/renderer/browser-renderer-base.js";
import playwright from "playwright";
import { createRequire } from "node:module";
import BotUtil from '#utils/botutil.js';
import Renderer from "#infrastructure/renderer/Renderer.js";

const { buildPlaywrightLaunchOptions, pickBrowserPath } = createRequire(import.meta.url)('./system-browser.cjs');

/**
 * Playwright-based browser renderer for screenshot generation.
 * 配置由 RendererLoader 通过 getRendererConfig('playwright') 注入。
 */
export default class PlaywrightRenderer extends BrowserRendererBase {
  constructor(config = {}) {
    super({ id: "playwright", type: "image", render: "screenshot" }, config, "PlaywrightRenderer");

    this.isClosing = false;
    this.browserType = config.browserType ?? config.browser ?? "chromium";
    this.playwrightTimeout = config.playwrightTimeout ?? 120000;
    this.healthCheckInterval = config.healthCheckInterval ?? 120000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 2000;

    const defaultArgs = [
      "--disable-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage",
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-extensions",
      "--disable-background-networking", "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows", "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--disable-ipc-flooding-protection", "--disable-renderer-backgrounding",
      "--force-color-profile=srgb", "--metrics-recording-only", "--mute-audio",
      "--no-first-run", "--enable-automation", "--password-store=basic",
      "--use-mock-keychain", "--disable-blink-features=AutomationControlled",
      "--js-flags=--max-old-space-size=512", "--disable-accelerated-2d-canvas",
      "--disable-accelerated-jpeg-decoding", "--disable-accelerated-mjpeg-decode",
      "--disable-accelerated-video-decode",
    ];
    this.launchOptions = buildPlaywrightLaunchOptions({
      headless: config.headless ?? true,
      args: config.args ?? defaultArgs,
      channel: config.channel,
      configuredPath: config.chromiumPath
    });
    this.wsEndpoint = pickBrowserPath(config.wsEndpoint ?? config.playwrightWS);

    const vp = config.viewport ?? config.contextOptions?.viewport ?? {};
    this.contextOptions = config.contextOptions ?? {
      viewport: { width: vp.width ?? 1280, height: vp.height ?? 720 },
      deviceScaleFactor: vp.deviceScaleFactor ?? 2,
      bypassCSP: true,
      reducedMotion: "reduce",
    };
  }

  async connectToExisting(wsEndpoint, retries = 0) {
    const delay = this.retryDelay * Math.pow(2, retries);
    try {
      BotUtil.makeLog("info", `Connecting to existing ${this.browserType} instance (attempt ${retries + 1}/${this.maxRetries})`, this.logTag);

      const browser = await playwright[this.browserType].connect(wsEndpoint, { timeout: 10000 });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("about:blank", { timeout: 5000 });
      await page.close();
      await context.close();

      BotUtil.makeLog("info", `Successfully connected to existing ${this.browserType} instance`, this.logTag);
      return browser;
    } catch (e) {
      BotUtil.makeLog("warn", `Connection failed: ${e.message}`, this.logTag);

      if (retries < this.maxRetries - 1) {
        await new Promise(r => setTimeout(r, delay));
        return this.connectToExisting(wsEndpoint, retries + 1);
      }

      await this.removeStoredEndpoint();
      return null;
    }
  }

  async browserInit() {
    if (this.browser) {
      try {
        this.browser.contexts();
        return this.browser;
      } catch (e) {
        BotUtil.makeLog("warn", `Existing browser instance invalid: ${e.message}`, this.logTag);
        this.browser = null;
      }
    }

    const lockResult = await this.waitForInitLock();
    if (lockResult !== true && lockResult !== false) return lockResult;
    if (lockResult === false) return false;

    this.lock = true;
    try {
      BotUtil.makeLog("info", `Starting playwright ${this.browserType}...`, this.logTag);

      await this.ensureMac(`AGT:${this.browserType}:browserURL`);
      const wsEndpoint = this.wsEndpoint || await this.resolveWsEndpoint();

      if (wsEndpoint) {
        this.browser = await this.connectToExisting(wsEndpoint);
      }

      if (!this.browser) {
        BotUtil.makeLog("info", `Launching new ${this.browserType} instance...`, this.logTag);
        if (this.launchOptions.executablePath) {
          BotUtil.makeLog("info", `Using browser: ${this.launchOptions.executablePath}`, this.logTag);
        }
        this.browser = await playwright[this.browserType].launch(this.launchOptions);

        if (this.browser) {
          BotUtil.makeLog("info", `Playwright ${this.browserType} started successfully`, this.logTag);
          await this.persistWsEndpoint(this.browser.wsEndpoint());
        }
      }

      if (!this.browser) {
        BotUtil.makeLog("error", `Playwright ${this.browserType} failed to start`, this.logTag);
        return false;
      }

      this.browser.on("disconnected", async () => {
        BotUtil.makeLog("warn", `${this.browserType} instance disconnected`, this.logTag);
        this.browser = null;
        await this.removeStoredEndpoint();

        if (!this.isClosing) {
          await this.restart(true);
        }
      });

      this.startHealthCheck();
    } catch (e) {
      if (/Executable doesn't exist/i.test(e.message)) {
        BotUtil.makeLog("error", "Playwright 浏览器未安装，请在启动菜单选择「Playwright 浏览器」安装，或执行: pnpm run setup:browsers", this.logTag);
      } else if (!this.launchOptions.executablePath) {
        BotUtil.makeLog("error", "未找到可用浏览器：请安装系统 Chrome/Chromium，或在启动菜单安装 Playwright Chromium", this.logTag);
      }
      BotUtil.makeLog("error", `Browser initialization failed: ${e.message}`, this.logTag);
      this.browser = null;
    } finally {
      this.lock = false;
    }

    return this.browser;
  }

  startHealthCheck() {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      if (!this.browser || this.shoting.length > 0 || this.isClosing) return;

      try {
        this.browser.contexts();
      } catch (e) {
        BotUtil.makeLog("warn", `Health check failed: ${e.message}, restarting...`, this.logTag);
        await this.restart(true);
      }
    }, this.healthCheckInterval);
  }

  async screenshot(name, data = {}) {
    await this.waitForScreenshotSlot();
    if (!await this.browserInit()) return false;

    const prepared = this.prepareScreenshotFile(name, data);
    if (!prepared) return false;

    const { filePath, pageHeight } = prepared;
    let ret = [];
    let context = null;
    let page = null;
    this.shoting.push(name);
    const start = Date.now();

    try {
      const sysScale = Number(data.sys?.scale);
      const contextOptions = { ...this.contextOptions };
      if (Number.isFinite(sysScale) && sysScale > 0) {
        contextOptions.deviceScaleFactor = Math.min(Math.max(sysScale, 1), 4);
      }
      context = await this.browser.newContext(contextOptions);
      page = await context.newPage();
      if (!page) throw new Error("Failed to create page");

      const gotoOpts = { timeout: this.playwrightTimeout, waitUntil: "load", ...data.pageGotoParams };
      await page.goto(Renderer.toFileUrl(filePath), gotoOpts);
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

      const body = (await page.locator("#container").first()) || (await page.locator("body"));
      if (!body) throw new Error("Content element not found");

      const boundingBox = await body.boundingBox();
      const screenshotOptions = {
        ...this.buildScreenshotOptions(data),
        fullPage: !data.multiPage,
      };

      let num = 1;
      if (data.multiPage) {
        screenshotOptions.type = "jpeg";
        screenshotOptions.fullPage = false;
        num = Math.ceil(boundingBox.height / pageHeight) || 1;
      }

      if (!data.multiPage) {
        const buff = await body.screenshot(screenshotOptions);
        this.renderNum++;
        const kb = (buff.length / 1024).toFixed(2) + "KB";
        BotUtil.makeLog("info", `[${name}][${this.renderNum}] ${kb} ${Date.now() - start}ms`, this.logTag);
        ret.push(buff);
      } else {
        if (num > 1) {
          await page.setViewportSize({
            width: Math.ceil(boundingBox.width),
            height: Math.min(pageHeight + 100, 2000),
          });
        }

        for (let i = 1; i <= num; i++) {
          if (i !== 1 && i === num) {
            const remainingHeight = Math.min(parseInt(boundingBox.height) - pageHeight * (num - 1), 2000);
            await page.setViewportSize({
              width: Math.ceil(boundingBox.width),
              height: remainingHeight > 0 ? remainingHeight : 100,
            });
          }

          if (i !== 1) {
            await page.evaluate(scrollY => window.scrollTo(0, scrollY), pageHeight * (i - 1));
            await page.waitForTimeout(100);
          }

          const clip = (i === num && num > 1) ? {
            x: boundingBox.x,
            y: 0,
            width: boundingBox.width,
            height: Math.min(boundingBox.height - pageHeight * (i - 1), pageHeight),
          } : null;

          const buff = clip
            ? await page.screenshot({ ...screenshotOptions, clip })
            : await body.screenshot(screenshotOptions);

          this.renderNum++;
          const kb = (buff.length / 1024).toFixed(2) + "KB";
          BotUtil.makeLog("debug", `[${name}][${i}/${num}] ${kb}`, this.logTag);
          ret.push(buff);

          if (i < num && num > 2) {
            await page.waitForTimeout(100);
          }
        }

        if (num > 1) {
          BotUtil.makeLog("info", `[${name}] Completed in ${Date.now() - start}ms`, this.logTag);
        }
      }
    } catch (error) {
      BotUtil.makeLog("error", `[${name}] Screenshot failed: ${error.message}`, this.logTag);
      ret = [];
    } finally {
      if (page) {
        try {
          await page.close({ runBeforeUnload: false });
        } catch {}
      }
      if (context) {
        try {
          await context.close();
        } catch {}
      }
      this.shoting = this.shoting.filter(item => item !== name);
    }

    return this.finishScreenshotRun(name, ret, data);
  }

  async restart(force = false) {
    if (!this.browser || this.lock || this.isClosing) return;
    if (!force && (this.renderNum % this.restartNum !== 0 || this.shoting.length > 0)) return;

    BotUtil.makeLog("warn", `${this.browserType} ${force ? "forced" : "scheduled"} restart...`, this.logTag);
    this.isClosing = true;

    try {
      const contexts = this.browser.contexts();
      for (const ctx of contexts) {
        await ctx.close().catch(() => {});
      }
      await this.browser.close();
      this.browser = null;

      await this.removeStoredEndpoint();
      this.renderNum = 0;
      this.clearHealthCheckTimer();

      if (global.gc) global.gc();

      BotUtil.makeLog("info", `${this.browserType} restart completed`, this.logTag);
    } catch (err) {
      BotUtil.makeLog("error", `Restart failed: ${err.message}`, this.logTag);
    } finally {
      this.isClosing = false;
    }

    return true;
  }

  async cleanup() {
    this.isClosing = true;
    this.clearHealthCheckTimer();

    if (this.browser) {
      const contexts = this.browser.contexts();
      for (const ctx of contexts) {
        await ctx.close().catch(() => {});
      }
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    await this.removeStoredEndpoint();
    BotUtil.makeLog("info", "Playwright resources cleaned up", this.logTag);
  }
}
