import BrowserRendererBase from "#infrastructure/renderer/browser-renderer-base.js";
import puppeteer from "puppeteer";
import { createRequire } from "node:module";
import BotUtil from "#utils/botutil.js";
import Renderer from "#infrastructure/renderer/Renderer.js";

const { resolvePlaywrightExecutable, pickBrowserPath } = createRequire(import.meta.url)('#utils/system-browser.cjs');

/**
 * Puppeteer-based browser renderer for screenshot generation.
 * 配置由 RendererLoader 通过 getRendererConfig('puppeteer') 注入。
 */
export default class PuppeteerRenderer extends BrowserRendererBase {
  constructor(config = {}) {
    super({ id: "puppeteer", type: "image", render: "screenshot" }, config, "PuppeteerRenderer");

    this.puppeteerTimeout = config.puppeteerTimeout ?? 120000;

    const vp = config.viewport ?? {};
    this.viewport = {
      width: vp.width ?? 1280,
      height: vp.height ?? 720,
      deviceScaleFactor: vp.deviceScaleFactor ?? 2,
    };
    this.config = {
      headless: config.headless ?? "new",
      args: config.args ?? ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
      wsEndpoint: pickBrowserPath(config.wsEndpoint ?? config.puppeteerWS),
    };
    const executablePath = resolvePlaywrightExecutable(config.chromiumPath);
    if (executablePath) this.config.executablePath = executablePath;
  }

  async browserInit() {
    if (this.browser) return this.browser;

    const lockResult = await this.waitForInitLock();
    if (lockResult !== true && lockResult !== false) return lockResult;
    if (lockResult === false) return false;

    this.lock = true;
    try {
      BotUtil.makeLog("info", "Starting puppeteer Chromium...", this.logTag);

      await this.ensureMac("AGT:chromium:browserWSEndpoint");
      const browserWSEndpoint = await this.resolveWsEndpoint();

      if (browserWSEndpoint) {
        try {
          BotUtil.makeLog("info", `Connecting to existing Chromium instance: ${browserWSEndpoint}`, this.logTag);
          this.browser = await puppeteer.connect({
            browserWSEndpoint,
            defaultViewport: null,
          });

          const pages = await this.browser.pages().catch(() => null);
          if (pages) {
            BotUtil.makeLog("info", "Successfully connected to existing Chromium instance", this.logTag);
          } else {
            BotUtil.makeLog("warn", "Connected Chromium instance unavailable, launching new instance", this.logTag);
            await this.browser.close().catch(() => {});
            this.browser = null;
            await this.removeStoredEndpoint();
          }
        } catch (e) {
          BotUtil.makeLog("warn", `Failed to connect to existing Chromium: ${e.message}`, this.logTag);
          await this.removeStoredEndpoint();
        }
      }

      if (!this.browser) {
        this.browser = await puppeteer.launch(this.config).catch((err) => {
          BotUtil.makeLog("error", `Failed to start Chromium: ${err.message}`, this.logTag);

          if (err.message.includes("Could not find Chromium")) {
            BotUtil.makeLog("error", "Chromium not installed. Try: node node_modules/puppeteer/install.js", this.logTag);
          } else if (err.message.includes("cannot open shared object file")) {
            BotUtil.makeLog("error", "Chromium runtime libraries not installed", this.logTag);
          }
          return null;
        });

        if (this.browser) {
          BotUtil.makeLog("info", `Puppeteer Chromium started successfully: ${this.browser.wsEndpoint()}`, this.logTag);
          await this.persistWsEndpoint(this.browser.wsEndpoint());
        }
      }

      if (!this.browser) {
        BotUtil.makeLog("error", "Puppeteer Chromium failed to start", this.logTag);
        return false;
      }

      this.browser.on("disconnected", () => {
        BotUtil.makeLog("warn", "Chromium instance disconnected, restarting...", this.logTag);
        this.browser = null;
        this.restart(true);
      });

      this.startHealthCheck();
    } catch (e) {
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
      if (!this.browser || this.shoting.length > 0) return;

      try {
        await this.browser.pages();
      } catch (e) {
        BotUtil.makeLog("warn", `Health check failed: ${e.message}, restarting...`, this.logTag);
        await this.restart(true);
      }
    }, 120000);
  }

  async screenshot(name, data = {}) {
    await this.waitForScreenshotSlot();
    if (!await this.browserInit()) return false;

    const prepared = this.prepareScreenshotFile(name, data);
    if (!prepared) return false;

    const { filePath, pageHeight } = prepared;
    let ret = [];
    let page = null;
    this.shoting.push(name);
    const start = Date.now();

    try {
      page = await this.browser.newPage();
      if (!page) throw new Error("Failed to create page");

      const sysScale = Number(data.sys?.scale);
      const viewport = { ...this.viewport };
      if (Number.isFinite(sysScale) && sysScale > 0) {
        viewport.deviceScaleFactor = Math.min(Math.max(sysScale, 1), 4);
      }
      await page.setViewport(viewport);

      const gotoOpts = { timeout: this.puppeteerTimeout, waitUntil: "load", ...data.pageGotoParams };
      await page.goto(Renderer.toFileUrl(filePath), gotoOpts);
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

      const body = (await page.$("#container")) || (await page.$("body"));
      if (!body) throw new Error("Content element not found");

      const boundingBox = await body.boundingBox();
      const screenshotOptions = this.buildScreenshotOptions(data);

      let num = 1;
      if (data.multiPage) {
        screenshotOptions.type = "jpeg";
        num = Math.ceil(boundingBox.height / pageHeight) || 1;
      }

      if (!data.multiPage) {
        const buff = await body.screenshot(screenshotOptions);
        const buffer = Buffer.isBuffer(buff) ? buff : Buffer.from(buff);
        this.renderNum++;
        const kb = (buffer.length / 1024).toFixed(2) + "KB";
        BotUtil.makeLog("info", `[${name}][${this.renderNum}] ${kb} ${Date.now() - start}ms`, this.logTag);
        ret.push(buffer);
      } else {
        if (num > 1) {
          await page.setViewport({
            width: Math.ceil(boundingBox.width),
            height: Math.min(pageHeight + 100, 2000),
          });
        }

        for (let i = 1; i <= num; i++) {
          if (i !== 1 && i === num) {
            const remainingHeight = Math.min(parseInt(boundingBox.height) - pageHeight * (num - 1), 2000);
            await page.setViewport({
              width: Math.ceil(boundingBox.width),
              height: remainingHeight > 0 ? remainingHeight : 100,
            });
          }

          if (i !== 1) {
            await page.evaluate(scrollY => window.scrollTo(0, scrollY), pageHeight * (i - 1));
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const buff = num === 1
            ? await body.screenshot(screenshotOptions)
            : await page.screenshot(screenshotOptions);
          const buffer = Buffer.isBuffer(buff) ? buff : Buffer.from(buff);
          this.renderNum++;
          const kb = (buffer.length / 1024).toFixed(2) + "KB";
          BotUtil.makeLog("debug", `[${name}][${i}/${num}] ${kb}`, this.logTag);
          ret.push(buffer);

          if (i < num && num > 2) {
            await new Promise(resolve => setTimeout(resolve, 100));
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
      if (page) await page.close().catch(() => {});
      this.shoting = this.shoting.filter(item => item !== name);
    }

    return this.finishScreenshotRun(name, ret, data);
  }

  async restart(force = false) {
    if (!this.browser || this.lock) return;
    if (!force && (this.renderNum % this.restartNum !== 0 || this.shoting.length > 0)) return;

    BotUtil.makeLog("warn", `Puppeteer Chromium ${force ? "forced" : "scheduled"} restart...`, this.logTag);

    try {
      const currentEndpoint = this.browser.wsEndpoint();

      const pages = await this.browser.pages();
      for (const page of pages) {
        await page.close().catch(() => {});
      }

      await this.browser.close().catch(err =>
        BotUtil.makeLog("error", `Failed to close browser: ${err.message}`, this.logTag)
      );
      this.browser = null;

      await this.removeStoredEndpoint(currentEndpoint);
      this.renderNum = 0;
      this.clearHealthCheckTimer();

      if (global.gc) global.gc();

      BotUtil.makeLog("info", "Browser restart completed", this.logTag);
    } catch (err) {
      BotUtil.makeLog("error", `Restart failed: ${err.message}`, this.logTag);
    }

    return true;
  }

  async cleanup() {
    this.clearHealthCheckTimer();

    if (this.browser) {
      const pages = await this.browser.pages().catch(() => []);
      for (const page of pages) {
        await page.close().catch(() => {});
      }
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    await this.removeStoredEndpoint();
    BotUtil.makeLog("info", "Puppeteer resources cleaned up", this.logTag);
  }
}
