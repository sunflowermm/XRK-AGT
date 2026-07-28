import fs from 'node:fs';
import path from 'node:path';
import lodash from 'lodash';
import RuntimeUtil from '#utils/runtime-util.js';
import paths from '#utils/paths.js';
import { registerShutdownHook } from '#utils/process-signals.js';
import Renderer from './Renderer.js';

/**
 * 浏览器截图渲染器基类（Puppeteer / Playwright 共用）
 *
 * 队列维度：
 * - 普通槽 shoting：受 maxConcurrent 限制
 * - 用户优先槽 shotingUser：data.priority / userTriggered 时独占一条（与 Yunzai 对齐）
 * - 槽位 id 唯一，禁止用模板 name 入队（同名并发会误清）
 * - 排队有超时，避免无限等待
 */
export default class BrowserRendererBase extends Renderer {
  logTag = '';
  browser = null;
  lock = false;
  /** @type {string[]} */
  shoting = [];
  /** @type {string[]} */
  shotingUser = [];
  mac = '';
  browserMacKey = null;
  restartNum = 100;
  renderNum = 0;
  maxConcurrent = 3;
  /** 排队等待默认超时（可被 data.queueWaitTimeout / 渲染器 timeout 覆盖） */
  queueWaitTimeoutMs = 120000;
  healthCheckTimer = null;
  _unregisterShutdownHook = null;

  constructor(meta, config = {}, logTag) {
    super(meta);
    this.logTag = logTag;
    this.restartNum = config.restartNum ?? this.restartNum;
    this.maxConcurrent = Math.max(1, Number(config.maxConcurrent) || this.maxConcurrent);
    this.queueWaitTimeoutMs =
      Number.isFinite(config.queueWaitTimeout) && config.queueWaitTimeout > 0
        ? config.queueWaitTimeout
        : this.queueWaitTimeoutMs;
    this._unregisterShutdownHook = registerShutdownHook(() => this.cleanup());
  }

  activeSlotCount() {
    return this.shoting.length + this.shotingUser.length;
  }

  isUserPriority(data = {}) {
    return data.priority === true || data.userTriggered === true;
  }

  makeScreenshotSlotId(name) {
    const label = String(name || 'shot').slice(0, 64);
    return `${label}#${Date.now().toString(36)}#${Math.random().toString(36).slice(2, 8)}`;
  }

  resolveQueueWaitMs(data = {}, rendererTimeout) {
    if (Number.isFinite(data.queueWaitTimeout) && data.queueWaitTimeout > 0) {
      return data.queueWaitTimeout;
    }
    if (Number.isFinite(rendererTimeout) && rendererTimeout > 0) {
      return rendererTimeout;
    }
    return this.queueWaitTimeoutMs;
  }

  /**
   * 原子占槽：检查与 push 之间无 await，避免同 tick 超并发。
   * @returns {{ slotId: string, userPriority: boolean } | null}
   */
  async acquireScreenshotSlot(name, data = {}, rendererTimeout) {
    const userPriority = this.isUserPriority(data);
    const slotId = this.makeScreenshotSlotId(name);
    const queueWaitMs = this.resolveQueueWaitMs(data, rendererTimeout);
    const waitStart = Date.now();

    for (;;) {
      if (userPriority) {
        if (this.shotingUser.length < 1) {
          this.shotingUser.push(slotId);
          return { slotId, userPriority };
        }
      } else if (this.activeSlotCount() < this.maxConcurrent) {
        this.shoting.push(slotId);
        return { slotId, userPriority };
      }

      if (Date.now() - waitStart > queueWaitMs) {
        RuntimeUtil.makeLog(
          'error',
          `[${name}] 渲染队列等待超时 (${queueWaitMs}ms)，slots=${this.shoting.length}+${this.shotingUser.length}`,
          this.logTag
        );
        return null;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  releaseScreenshotSlot(slotId, userPriority = false) {
    if (!slotId) return;
    const list = userPriority ? this.shotingUser : this.shoting;
    const i = list.indexOf(slotId);
    if (i >= 0) list.splice(i, 1);
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
    if (this.renderNum % this.restartNum === 0 && this.renderNum > 0 && this.activeSlotCount() === 0) {
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

  /** launch 时去掉 connect 专用字段，避免脏参数 */
  buildBrowserLaunchOptions(extra = {}) {
    const { wsEndpoint: _ws, ignoreHTTPSErrors: _https, ...rest } = { ...(this.config || {}), ...extra };
    return rest;
  }
}
