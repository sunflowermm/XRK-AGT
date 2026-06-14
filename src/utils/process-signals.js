import { isShuttingDown } from '#utils/runtime-globals.js';

/** 连续按键判定窗口（毫秒） */
export const SIGNAL_STRIKE_WINDOW_MS = 3000;

/** server / menu 模式下按几次退出（返回菜单或退出程序） */
export const SIGNAL_STRIKES_TO_EXIT = 3;

/** Windows STATUS_CONTROL_C_EXIT（spawnSync 可能返回的无符号形式） */
export const WIN_STATUS_CONTROL_C_EXIT = 3221225786;

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
 * 规范化 spawnSync 子进程退出码（Windows Ctrl+C 视为返回菜单）
 * @param {number | null | undefined} status
 * @param {number} [exitStop=0]
 */
export function normalizeChildExitCode(status, exitStop = 0) {
  if (status === null || status === undefined) return 1;
  if (status === 130 || status === exitStop) return exitStop;
  if (status === WIN_STATUS_CONTROL_C_EXIT || status === -1073741510) return exitStop;
  return status;
}

/**
 * 统一进程信号
 *
 * **server**：1 次重启 → 2 次提示 → 3 次返回菜单；关闭中再按强制 exit(130)
 * **menu**：连按 3 次退出程序（子进程 spawnSync 期间 pause 且结束后 resetStrikes）
 */
export class ProcessSignalController {
  /** @type {Record<string, () => void>} */
  _handlers = {};

  /**
   * @param {{
   *   mode: 'menu' | 'server',
   *   strikeWindowMs?: number,
   *   strikesToExit?: number,
   *   logger?: { warning?: (msg: string) => void, mark?: (msg: string) => void, log?: (msg: string) => void },
   *   onRestart?: (signal: string) => void | Promise<void>,
   *   onStop?: (signal: string) => void | Promise<void>,
   *   onForceExit?: (signal: string) => void | Promise<void>,
   * }} options
   */
  constructor(options) {
    this.mode = options.mode;
    this.strikeWindowMs = options.strikeWindowMs ?? SIGNAL_STRIKE_WINDOW_MS;
    this.strikesToExit = options.strikesToExit ?? SIGNAL_STRIKES_TO_EXIT;
    this.logger = options.logger;
    this.onRestart = options.onRestart;
    this.onStop = options.onStop;
    this.onForceExit = options.onForceExit;
    this.lastSignal = null;
    this.lastStrikeTime = 0;
    this.strikeCount = 0;
    this.paused = false;
    this.installed = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  resetStrikes() {
    this.lastSignal = null;
    this.lastStrikeTime = 0;
    this.strikeCount = 0;
  }

  install() {
    if (this.installed) return;
    for (const signal of SIGNALS) {
      const handler = () => {
        void this._handle(signal);
      };
      this._handlers[signal] = handler;
      process.on(signal, handler);
    }
    this.installed = true;
  }

  async uninstall() {
    if (!this.installed) return;
    for (const [signal, handler] of Object.entries(this._handlers)) {
      process.removeListener(signal, handler);
    }
    this._handlers = {};
    this.installed = false;
    this.resetStrikes();
  }

  /** @returns {number} */
  _bumpStrike(signal) {
    const now = Date.now();
    if (
      this.lastSignal !== signal ||
      now - this.lastStrikeTime > this.strikeWindowMs
    ) {
      this.strikeCount = 1;
    } else {
      this.strikeCount += 1;
    }
    this.lastSignal = signal;
    this.lastStrikeTime = now;
    return this.strikeCount;
  }

  _notify(message, level = 'mark') {
    const fn = this.logger?.[level];
    if (fn) fn(message);
    else syncSignalNotice(message);
  }

  async _forceExit(signal) {
    this._notify(`强制退出 (${signal})`, 'mark');
    await this.onForceExit?.(signal);
    process.exit(130);
  }

  async _handle(signal) {
    if (this.paused) return;

    if (isShuttingDown()) {
      await this._forceExit(signal);
      return;
    }

    const strike = this._bumpStrike(signal);

    if (this.mode === 'menu') {
      if (strike >= this.strikesToExit) {
        this._notify(`连续 ${strike} 次 ${signal}，退出程序`, 'mark');
        await this.onForceExit?.(signal);
        process.exit(0);
        return;
      }
      const left = this.strikesToExit - strike;
      this._notify(`收到 ${signal}，再按 ${left} 次退出程序`, 'warning');
      return;
    }

    if (strike >= this.strikesToExit) {
      this._notify(`连续 ${strike} 次 ${signal}，正在关闭并返回菜单`, 'mark');
      try {
        await this.onStop?.(signal);
      } catch (err) {
        this._notify(`关闭失败: ${err.message}`, 'mark');
        process.exit(0);
      }
      return;
    }

    if (strike === 1) {
      this._notify(`收到 ${signal}，正在重启（连按 ${this.strikesToExit} 次返回菜单）`, 'mark');
      void Promise.resolve(this.onRestart?.(signal)).catch((err) => {
        this._notify(`重启失败: ${err.message}`, 'mark');
        process.exit(1);
      });
      return;
    }

    const left = this.strikesToExit - strike;
    this._notify(`再按 ${left} 次 ${signal} 将返回菜单`, 'mark');
  }
}

/** @param {ConstructorParameters<typeof ProcessSignalController>[0]} options */
export function installProcessSignals(options) {
  const controller = new ProcessSignalController(options);
  controller.install();
  return controller;
}
