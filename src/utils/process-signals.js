import readline from 'node:readline';

/** 连按两次退出的判定窗口（毫秒） */
export const SIGNAL_TIME_THRESHOLD_MS = 3000;

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const shutdownHooks = new Set();

/**
 * @param {() => void | Promise<void>} fn
 * @returns {() => void}
 */
export function registerShutdownHook(fn) {
  shutdownHooks.add(fn);
  return () => shutdownHooks.delete(fn);
}

export async function runShutdownHooks() {
  await Promise.allSettled([...shutdownHooks].map((fn) => fn()));
}

/**
 * 启动菜单信号：服务器运行中忽略 Ctrl+C（由子进程 loader 处理）；菜单界面连按两次退出。
 */
export class MenuSignalHandler {
  /** @param {{ log?: (msg: string, level?: string) => void | Promise<void>, warning?: (msg: string) => void | Promise<void> }} logger */
  constructor(logger = {}) {
    this.logger = logger;
    this.lastSignal = null;
    this.lastSignalTime = 0;
    this.isSetup = false;
    this.inRestartLoop = false;
    /** @type {Record<string, () => void>} */
    this.handlers = {};
    /** @type {readline.Interface | null} */
    this._rl = null;
  }

  _closeReadline() {
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
  }

  _ensureReadline() {
    if (!this.isSetup || !process.stdin || this._rl) return;
    this._rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this._rl.on('SIGINT', () => process.emit('SIGINT'));
  }

  setup() {
    if (this.isSetup) return;
    for (const signal of SIGNALS) {
      const handler = () => {
        void this._handle(signal);
      };
      this.handlers[signal] = handler;
      process.on(signal, handler);
    }
    this._ensureReadline();
    this.isSetup = true;
  }

  async cleanup() {
    if (!this.isSetup) return;
    this._closeReadline();
    for (const [signal, handler] of Object.entries(this.handlers)) {
      process.removeListener(signal, handler);
    }
    this.handlers = {};
    this.isSetup = false;
    this.inRestartLoop = false;
    this.lastSignal = null;
    this.lastSignalTime = 0;
  }

  async _handle(signal) {
    const now = Date.now();
    if (this.inRestartLoop) return;
    if (signal === this.lastSignal && now - this.lastSignalTime < SIGNAL_TIME_THRESHOLD_MS) {
      await this.logger.log?.(`检测到双击 ${signal} 信号，准备退出`, 'INFO');
      await this.cleanup();
      process.exit(0);
      return;
    }
    this.lastSignal = signal;
    this.lastSignalTime = now;
    await this.logger.warning?.(`收到 ${signal} 信号，再次发送将退出程序`);
  }
}
