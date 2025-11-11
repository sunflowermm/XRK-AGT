import Renderer from "../../../lib/renderer/Renderer.js";
import os from "node:os";
import lodash from "lodash";
import puppeteer from "puppeteer";
import cfg from "../../../lib/config/config.js";
import fs from "node:fs";
import path from "node:path";
import BotUtil from "../../../lib/common/util.js";

const _path = process.cwd();

/**
 * Puppeteer-based browser renderer for screenshot generation
 * Supports browser instance reuse, memory management, and health monitoring
 */
export default class PuppeteerRenderer extends Renderer {
  constructor(config = {}) {
    super({
      id: "puppeteer",
      type: "image",
      render: "screenshot",
    });

    this.browser = null;
    this.lock = false;
    this.shoting = [];
    this.mac = "";
    this.browserMacKey = null;

    const rendererCfg = cfg.renderer?.puppeteer || {};
    
    this.restartNum = config.restartNum ?? rendererCfg.restartNum ?? 100;
    this.renderNum = 0;
    this.puppeteerTimeout = config.puppeteerTimeout ?? rendererCfg.puppeteerTimeout ?? 120000;
    this.memoryThreshold = config.memoryThreshold ?? rendererCfg.memoryThreshold ?? 1024;
    this.maxConcurrent = config.maxConcurrent ?? rendererCfg.maxConcurrent ?? 3;

    this.config = {
      headless: config.headless ?? rendererCfg.headless ?? "new",
      args: config.args ?? rendererCfg.args ?? [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--allow-file-access-from-files',
        '--disable-infobars',
        '--disable-notifications',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--js-flags=--max-old-space-size=512',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-accelerated-video-decode',
        '--disable-software-rasterizer',
      ],
      executablePath: config.chromiumPath ?? rendererCfg.chromiumPath,
      wsEndpoint: config.puppeteerWS ?? rendererCfg.wsEndpoint,
    };

    this.healthCheckTimer = null;

    process.on("exit", () => this.cleanup());
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  /**
   * Retrieve system MAC address for browser instance identification
   */
  async getMac() {
    let macAddr = "000000000000";
    try {
      const network = os.networkInterfaces();
      for (const key in network) {
        for (const iface of network[key]) {
          if (iface.mac && iface.mac !== "00:00:00:00:00:00") {
            return iface.mac.replace(/:/g, "");
          }
        }
      }
    } catch (e) {
      BotUtil.makeLog("error", `Failed to get MAC address: ${e.message}`, "PuppeteerRenderer");
    }
    return macAddr;
  }

  /**
   * Initialize browser instance with connection reuse
   */
  async browserInit() {
    if (this.browser) return this.browser;

    if (this.lock) {
      let waitTime = 0;
      while (this.lock && waitTime < 30000) {
        await new Promise(r => setTimeout(r, 100));
        waitTime += 100;
      }
      if (this.browser) return this.browser;
      if (this.lock) return false;
    }

    this.lock = true;
    try {
      BotUtil.makeLog("info", "Starting puppeteer Chromium...", "PuppeteerRenderer");

      if (!this.mac) {
        this.mac = await this.getMac();
        this.browserMacKey = `Yz:chromium:browserWSEndpoint:${this.mac}`;
      }

      let browserWSEndpoint = null;
      if (this.browserMacKey) {
        try {
          browserWSEndpoint = await redis.get(this.browserMacKey);
        } catch (e) {}
      }
      if (!browserWSEndpoint && this.config.wsEndpoint) {
        browserWSEndpoint = this.config.wsEndpoint;
      }

      if (browserWSEndpoint) {
        try {
          BotUtil.makeLog("info", `Connecting to existing Chromium instance: ${browserWSEndpoint}`, "PuppeteerRenderer");
          this.browser = await puppeteer.connect({
            browserWSEndpoint,
            defaultViewport: null,
          });

          const pages = await this.browser.pages().catch(() => null);
          if (pages) {
            BotUtil.makeLog("info", "Successfully connected to existing Chromium instance", "PuppeteerRenderer");
          } else {
            BotUtil.makeLog("warn", "Connected Chromium instance unavailable, launching new instance", "PuppeteerRenderer");
            await this.browser.close().catch(() => {});
            this.browser = null;
            
            if (this.browserMacKey) {
              await redis.del(this.browserMacKey).catch(() => {});
            }
          }
        } catch (e) {
          BotUtil.makeLog("warn", `Failed to connect to existing Chromium: ${e.message}`, "PuppeteerRenderer");
          if (this.browserMacKey) {
            await redis.del(this.browserMacKey).catch(() => {});
          }
        }
      }

      if (!this.browser) {
        this.browser = await puppeteer.launch(this.config).catch(err => {
          BotUtil.makeLog("error", `Failed to start Chromium: ${err.message}`, "PuppeteerRenderer");
          
          if (err.message.includes("Could not find Chromium")) {
            BotUtil.makeLog("error", "Chromium not installed. Try: node node_modules/puppeteer/install.js", "PuppeteerRenderer");
          } else if (err.message.includes("cannot open shared object file")) {
            BotUtil.makeLog("error", "Chromium runtime libraries not installed", "PuppeteerRenderer");
          }
          return null;
        });

        if (this.browser) {
          BotUtil.makeLog("info", `Puppeteer Chromium started successfully: ${this.browser.wsEndpoint()}`, "PuppeteerRenderer");
          
          if (this.browserMacKey) {
            try {
              await redis.set(this.browserMacKey, this.browser.wsEndpoint(), { EX: 60 * 60 * 24 * 30 });
            } catch (e) {
              BotUtil.makeLog("error", `Failed to save browser instance: ${e.message}`, "PuppeteerRenderer");
            }
          }
        }
      }

      if (!this.browser) {
        BotUtil.makeLog("error", "Puppeteer Chromium failed to start", "PuppeteerRenderer");
        return false;
      }

      this.browser.on("disconnected", () => {
        BotUtil.makeLog("warn", "Chromium instance disconnected, restarting...", "PuppeteerRenderer");
        this.browser = null;
        this.restart(true);
      });

      this.startHealthCheck();
    } catch (e) {
      BotUtil.makeLog("error", `Browser initialization failed: ${e.message}`, "PuppeteerRenderer");
      this.browser = null;
    } finally {
      this.lock = false;
    }

    return this.browser;
  }

  /**
   * Start periodic health check for browser instance
   */
  startHealthCheck() {
    if (this.healthCheckTimer) return;
    
    this.healthCheckTimer = setInterval(async () => {
      if (!this.browser || this.shoting.length > 0) return;
      
      try {
        await this.browser.pages();
      } catch (e) {
        BotUtil.makeLog("warn", `Health check failed: ${e.message}, restarting...`, "PuppeteerRenderer");
        await this.restart(true);
      }
    }, 120000);
  }

  /**
   * Generate screenshot with optimized resource management
   */
  async screenshot(name, data = {}) {
    while (this.shoting.length >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100));
    }

    if (!await this.browserInit()) return false;

    const pageHeight = data.multiPageHeight ?? 4000;
    const savePath = this.dealTpl(name, data);
    if (!savePath) return false;

    const filePath = path.join(_path, lodash.trim(savePath, "."));
    if (!fs.existsSync(filePath)) {
      BotUtil.makeLog("error", `HTML file does not exist: ${filePath}`, "PuppeteerRenderer");
      return false;
    }

    let ret = [];
    let page = null;
    this.shoting.push(name);
    const start = Date.now();

    try {
      page = await this.browser.newPage();
      if (!page) throw new Error("Failed to create page");

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (['font', 'media'].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
      });

      const pageGotoParams = lodash.extend(
        { timeout: this.puppeteerTimeout, waitUntil: "domcontentloaded" },
        data.pageGotoParams || {}
      );

      const fileUrl = `file://${filePath}`;
      BotUtil.makeLog("debug", `[${name}] Loading file: ${fileUrl}`, "PuppeteerRenderer");
      await page.goto(fileUrl, pageGotoParams);

      await page.evaluate(() => new Promise(resolve => {
        const timeout = setTimeout(resolve, 800);
        const images = document.querySelectorAll("img");
        
        if (images.length === 0) {
          clearTimeout(timeout);
          return resolve();
        }
        
        let loaded = 0;
        const checkComplete = () => {
          loaded++;
          if (loaded === images.length) {
            clearTimeout(timeout);
            resolve();
          }
        };
        
        images.forEach(img => {
          if (img.complete) checkComplete();
          else {
            img.onload = checkComplete;
            img.onerror = checkComplete;
          }
        });
      }));

      const body = (await page.$("#container")) || (await page.$("body"));
      if (!body) throw new Error("Content element not found");

      const boundingBox = await body.boundingBox();

      const screenshotOptions = {
        type: data.imgType ?? "jpeg",
        omitBackground: data.omitBackground ?? false,
        quality: data.quality ?? 85,
        path: data.path ?? "",
      };

      if (data.imgType === "png") delete screenshotOptions.quality;

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
        BotUtil.makeLog("info", `[${name}][${this.renderNum}] ${kb} ${Date.now() - start}ms`, "PuppeteerRenderer");
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
          BotUtil.makeLog("debug", `[${name}][${i}/${num}] ${kb}`, "PuppeteerRenderer");
          ret.push(buffer);

          if (i < num && num > 2) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        if (num > 1) {
          BotUtil.makeLog("info", `[${name}] Completed in ${Date.now() - start}ms`, "PuppeteerRenderer");
        }
      }
    } catch (error) {
      BotUtil.makeLog("error", `[${name}] Screenshot failed: ${error.message}`, "PuppeteerRenderer");
      ret = [];
    } finally {
      if (page) {
        page.removeAllListeners('request');
        await page.close().catch(() => {});
      }
      this.shoting = this.shoting.filter(item => item !== name);
    }

    if (this.renderNum % this.restartNum === 0 && this.renderNum > 0 && this.shoting.length === 0) {
      BotUtil.makeLog("info", `Completed ${this.renderNum} screenshots, restarting browser...`, "PuppeteerRenderer");
      setTimeout(() => this.restart(), 2000);
    }

    if (ret.length === 0 || !ret[0]) {
      BotUtil.makeLog("error", `[${name}] Screenshot result is empty`, "PuppeteerRenderer");
      return false;
    }

    return data.multiPage ? ret : ret[0];
  }

  /**
   * Restart browser instance with cleanup
   */
  async restart(force = false) {
    if (!this.browser || this.lock) return;
    if (!force && (this.renderNum % this.restartNum !== 0 || this.shoting.length > 0)) return;

    BotUtil.makeLog("warn", `Puppeteer Chromium ${force ? "forced" : "scheduled"} restart...`, "PuppeteerRenderer");

    try {
      const currentEndpoint = this.browser.wsEndpoint();
      
      const pages = await this.browser.pages();
      for (const page of pages) {
        await page.close().catch(() => {});
      }
      
      await this.browser.close().catch(err => 
        BotUtil.makeLog("error", `Failed to close browser: ${err.message}`, "PuppeteerRenderer")
      );
      this.browser = null;

      if (this.browserMacKey) {
        const storedEndpoint = await redis.get(this.browserMacKey).catch(() => null);
        if (storedEndpoint === currentEndpoint) {
          await redis.del(this.browserMacKey).catch(() => {});
        }
      }

      this.renderNum = 0;

      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }

      if (global.gc) {
        global.gc();
      }
      
      BotUtil.makeLog("info", "Browser restart completed", "PuppeteerRenderer");
    } catch (err) {
      BotUtil.makeLog("error", `Restart failed: ${err.message}`, "PuppeteerRenderer");
    }

    return true;
  }

  /**
   * Clean up all resources on process exit
   */
  async cleanup() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.browser) {
      const pages = await this.browser.pages().catch(() => []);
      for (const page of pages) {
        await page.close().catch(() => {});
      }
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    if (this.browserMacKey) {
      await redis.del(this.browserMacKey).catch(() => {});
    }

    BotUtil.makeLog("info", "Puppeteer resources cleaned up", "PuppeteerRenderer");
  }
}