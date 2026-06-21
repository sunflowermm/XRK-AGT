import readline from 'node:readline';

/** 连续按键判定窗口（毫秒） */
export const SIGNAL_STRIKE_WINDOW_MS = 3000;
export const SIGNAL_TIME_THRESHOLD_MS = SIGNAL_STRIKE_WINDOW_MS;

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

/** 无 logger 时的兜底输出（不额外空行） */
export function syncSignalNotice(message) {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    try {
      console.warn(message);
    } catch {}
  }
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
    /** @type {import('node:child_process').ChildProcess | null} */
    this.currentChild = null;
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
    this.currentChild = null;
    this.lastSignal = null;
    this.lastSignalTime = 0;
  }

  _shouldExit(signal, now) {
    return signal === this.lastSignal && now - this.lastSignalTime < SIGNAL_STRIKE_WINDOW_MS;
  }

  async _handle(signal) {
    const now = Date.now();
    // 子进程与父进程同组，终端 SIGINT 会直达子进程；勿再 kill 避免双重 SIGINT
    if (this.inRestartLoop) return;
    if (this._shouldExit(signal, now)) {
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
