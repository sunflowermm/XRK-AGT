import fs from 'node:fs';
import path from 'node:path';
import lodash from 'lodash';
import RuntimeUtil from '#utils/runtime-util.js';
import paths from '#utils/paths.js';
import { registerShutdownHook } from '#utils/process-signals.js';
import Renderer from './Renderer.js';

/**
 * 浏览器截图渲染器基类（Puppeteer / Playwright 共用状态与工具方法）
 */
export default class BrowserRendererBase extends Renderer {
  logTag = '';
  browser = null;
  lock = false;
  shoting = [];
  mac = '';
  browserMacKey = null;
  restartNum = 100;
  renderNum = 0;
  maxConcurrent = 3;
  healthCheckTimer = null;
  _unregisterShutdownHook = null;

  constructor(meta, config = {}, logTag) {
    super(meta);
    this.logTag = logTag;
    this.restartNum = config.restartNum ?? this.restartNum;
    this.maxConcurrent = config.maxConcurrent ?? this.maxConcurrent;
    this._unregisterShutdownHook = registerShutdownHook(() => this.cleanup());
  }

  async waitForInitLock() {
    if (!this.lock) return this.browser ?? true;

    let waitTime = 0;
    while (this.lock && waitTime < 30000) {
      await new Promise((r) => setTimeout(r, 100));
      waitTime += 100;
    }

    if (this.browser) return this.browser;
    return this.lock ? false : true;
  }

  async waitForScreenshotSlot() {
    while (this.shoting.length >= this.maxConcurrent) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async ensureMac(redisKeyPrefix) {
    if (this.mac) return;
    this.mac = await this.getMac();
    this.browserMacKey = `${redisKeyPrefix}:${this.mac}`;
  }

  async resolveWsEndpoint() {
    let endpoint = null;
    if (this.browserMacKey) {
      try {
        endpoint = await redis.get(this.browserMacKey);
      } catch {}
    }
    return endpoint || this.config?.wsEndpoint || null;
  }

  async persistWsEndpoint(endpoint) {
    if (!endpoint || !this.browserMacKey) return;
    try {
      await redis.set(this.browserMacKey, endpoint, { EX: 60 * 60 * 24 * 30 });
    } catch (err) {
      RuntimeUtil.makeLog('error', `Failed to save browser instance: ${err.message}`, this.logTag);
    }
  }

  async removeStoredEndpoint(expectedEndpoint = null) {
    if (!this.browserMacKey) return;
    try {
      if (expectedEndpoint) {
        const stored = await redis.get(this.browserMacKey);
        if (stored !== expectedEndpoint) return;
      }
      await redis.del(this.browserMacKey);
    } catch {}
  }

  prepareScreenshotFile(name, data) {
    data._baseUrl = Renderer.toFileUrl(paths.root);
    const pageHeight = data.multiPageHeight ?? 4000;
    const savePath = this.dealTpl(name, data);
    if (!savePath) return null;

    const filePath = path.join(paths.root, lodash.trimStart(savePath, '.'));
    if (!fs.existsSync(filePath)) {
      RuntimeUtil.makeLog('error', `HTML file does not exist: ${filePath}`, this.logTag);
      return null;
    }

    return { filePath, pageHeight };
  }

  buildScreenshotOptions(data) {
    const screenshotOptions = {
      type: data.imgType ?? 'jpeg',
      omitBackground: data.omitBackground ?? false,
      quality: data.quality ?? 85,
      path: data.path ?? ''
    };

    if (data.imgType === 'png') delete screenshotOptions.quality;
    return screenshotOptions;
  }

  finishScreenshotRun(name, ret, data) {
    if (this.renderNum % this.restartNum === 0 && this.renderNum > 0 && this.shoting.length === 0) {
      RuntimeUtil.makeLog('info', `Completed ${this.renderNum} screenshots, restarting browser...`, this.logTag);
      setTimeout(() => this.restart(), 2000);
    }

    if (ret.length === 0 || !ret[0]) {
      RuntimeUtil.makeLog('error', `[${name}] Screenshot result is empty`, this.logTag);
      return false;
    }

    return data.multiPage ? ret : ret[0];
  }

  clearHealthCheckTimer() {
    if (!this.healthCheckTimer) return;
    clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
  }
}
