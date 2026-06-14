import chokidar from 'chokidar';
import lodash from 'lodash';
import path from 'path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';
import { normalizeError } from '#utils/normalize-error.js';
import { isShuttingDown } from '#utils/runtime-globals.js';

const DEFAULT_AWAIT_WRITE_FINISH = {
  stabilityThreshold: 300,
  pollInterval: 100
};

function normalizeWatchPath(filePath) {
  return path.resolve(String(filePath ?? ''));
}

function normalizeWatchTargets(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(normalizeWatchPath).filter(Boolean);
}

export class HotReloadBase {
  watcher = null;
  _debouncers = [];
  _stopping = false;
  _stopPromise = null;
  _pendingTargets = [];

  constructor(options = {}) {
    this.loggerName = options.loggerName ?? 'HotReload';
    this.debounceDelay = options.debounceDelay ?? 500;
    this.awaitWriteFinish = options.awaitWriteFinish ?? DEFAULT_AWAIT_WRITE_FINISH;
  }

  get isWatching() {
    return Boolean(this.watcher) && !this._stopping;
  }

  isValidFile(filePath) {
    const fileName = path.basename(filePath);
    return fileName.endsWith('.js') && !fileName.startsWith('.') && !fileName.startsWith('_');
  }

  /**
   * @param {boolean} enable
   * @param {object} options
   * @param {string|string[]} [options.dirs]
   * @param {string|string[]} [options.files] 单文件监视（YAML/HTML 等）
   * @param {(filePath: string) => void|Promise<void>} [options.onAdd]
   * @param {(filePath: string) => void|Promise<void>} [options.onChange]
   * @param {(filePath: string) => void|Promise<void>} [options.onUnlink]
   * @param {(dirPath: string) => void|Promise<void>} [options.onAddDir]
   * @param {(dirPath: string) => void|Promise<void>} [options.onUnlinkDir]
   * @param {(filePath: string, event: string) => boolean} [options.shouldHandle]
   * @param {boolean} [options.invalidateCoreCacheOnAdd]
   * @returns {Promise<boolean>} 是否已成功启动监视
   */
  async watch(enable = true, options = {}) {
    if (!enable) {
      await this.stop();
      return false;
    }
    if (isShuttingDown() || this._stopping) return false;
    if (this.watcher) return true;

    const {
      dirs,
      files,
      onAdd,
      onChange,
      onUnlink,
      onAddDir,
      onUnlinkDir,
      shouldHandle,
      invalidateCoreCacheOnAdd = normalizeWatchTargets(files).length === 0
    } = options;

    const targets = [
      ...normalizeWatchTargets(dirs),
      ...normalizeWatchTargets(files),
      ...this._pendingTargets.splice(0)
    ];
    if (targets.length === 0) return false;

    if (this._stopping || isShuttingDown()) return false;

    const handleCheck = shouldHandle ?? ((filePath) => this.isValidFile(filePath));

    try {
      this.watcher = chokidar.watch(targets, {
        ignored: /(^|[/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: this.awaitWriteFinish
      });
    } catch (err) {
      this.watcher = null;
      const error = normalizeError(err);
      BotUtil.makeLog('error', `启动文件监视失败: ${error.message}`, this.loggerName, error);
      return false;
    }

    const bind = (event, handler, { skipCheck = false } = {}) => {
      if (!handler) return;
      const debounced = lodash.debounce(async (filePath) => {
        if (this._stopping || !this.watcher) return;
        if (!skipCheck && !handleCheck(filePath, event)) return;
        try {
          if (event === 'add' && invalidateCoreCacheOnAdd) {
            paths.invalidateCoreCache();
          }
          await handler(filePath);
        } catch (err) {
          const error = normalizeError(err);
          BotUtil.makeLog('error', `热更新 ${event} 失败: ${filePath}`, this.loggerName, error);
        }
      }, this.debounceDelay);
      this._debouncers.push(debounced);
      this.watcher.on(event, debounced);
    };

    bind('add', onAdd);
    bind('change', onChange);
    bind('unlink', onUnlink);
    bind('addDir', onAddDir, { skipCheck: true });
    bind('unlinkDir', onUnlinkDir, { skipCheck: true });

    this.watcher.on('error', (err) => {
      if (this._stopping) return;
      const error = normalizeError(err);
      BotUtil.makeLog('error', '文件监视错误', this.loggerName, error);
    });
    BotUtil.makeLog('info', '文件监视已启动', this.loggerName);
    return true;
  }

  /**
   * 向已运行的监视器追加路径（watch 尚未完成时先入队，随 watch 一并注册）
   * @returns {boolean} 是否已接受（入队或已 add）
   */
  addTargets(targets) {
    if (this._stopping || isShuttingDown()) return false;

    const list = normalizeWatchTargets(targets);
    if (list.length === 0) return true;

    if (!this.watcher) {
      this._pendingTargets.push(...list);
      return true;
    }

    try {
      for (const target of list) {
        this.watcher.add(target);
      }
      return true;
    } catch (err) {
      const error = normalizeError(err);
      BotUtil.makeLog('error', `追加监视路径失败: ${error.message}`, this.loggerName, error);
      return false;
    }
  }

  async stop() {
    if (this._stopPromise) return this._stopPromise;
    this._stopPromise = this._stopInternal();
    try {
      await this._stopPromise;
    } finally {
      this._stopPromise = null;
    }
  }

  async _stopInternal() {
    this._stopping = true;
    this._pendingTargets.length = 0;

    for (const debounced of this._debouncers) {
      debounced.cancel?.();
    }
    this._debouncers.length = 0;

    const watcher = this.watcher;
    this.watcher = null;
    if (!watcher) {
      this._stopping = false;
      return;
    }

    watcher.removeAllListeners();
    try {
      await watcher.close();
    } catch (err) {
      const error = normalizeError(err);
      BotUtil.makeLog('debug', `关闭文件监视: ${error.message}`, this.loggerName);
    } finally {
      this._stopping = false;
    }
  }

  getFileKey(filePath) {
    return path.basename(filePath, '.js');
  }

  /** 模块文件键（路径或文件名 → 不含 .js 的 basename） */
  static moduleFileKey(nameOrPath) {
    const base = path.basename(String(nameOrPath ?? ''));
    return base.endsWith('.js') ? base.slice(0, -3) : base;
  }

  /** 监视路径归一化（与 chokidar 事件路径对齐，避免 Windows 分隔符不一致） */
  static resolveWatchPath(filePath) {
    return normalizeWatchPath(filePath);
  }
}
