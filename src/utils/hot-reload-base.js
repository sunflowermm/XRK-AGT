import chokidar from 'chokidar';
import lodash from 'lodash';
import path from 'path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';

const DEFAULT_AWAIT_WRITE_FINISH = {
  stabilityThreshold: 300,
  pollInterval: 100
};

function normalizeWatchTargets(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export class HotReloadBase {
  watcher = null;

  constructor(options = {}) {
    this.loggerName = options.loggerName ?? 'HotReload';
    this.debounceDelay = options.debounceDelay ?? 500;
    this.awaitWriteFinish = options.awaitWriteFinish ?? DEFAULT_AWAIT_WRITE_FINISH;
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
   */
  async watch(enable = true, options = {}) {
    if (!enable) {
      await this.stop();
      return;
    }
    if (this.watcher) return;

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
      ...normalizeWatchTargets(files)
    ];
    if (targets.length === 0) return;

    const handleCheck = shouldHandle ?? ((filePath) => this.isValidFile(filePath));

    this.watcher = chokidar.watch(targets, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: this.awaitWriteFinish
    });

    const bind = (event, handler, { skipCheck = false } = {}) => {
      if (!handler) return;
      this.watcher.on(event, lodash.debounce(async (filePath) => {
        if (!skipCheck && !handleCheck(filePath, event)) return;
        try {
          if (event === 'add' && invalidateCoreCacheOnAdd) {
            paths.invalidateCoreCache();
          }
          await handler(filePath);
        } catch (error) {
          BotUtil.makeLog('error', `热更新 ${event} 失败: ${filePath}`, this.loggerName, error);
        }
      }, this.debounceDelay));
    };

    bind('add', onAdd);
    bind('change', onChange);
    bind('unlink', onUnlink);
    bind('addDir', onAddDir, { skipCheck: true });
    bind('unlinkDir', onUnlinkDir, { skipCheck: true });

    this.watcher.on('error', (error) => {
      BotUtil.makeLog('error', '文件监视错误', this.loggerName, error);
    });
    BotUtil.makeLog('info', '文件监视已启动', this.loggerName);
  }

  async stop() {
    if (!this.watcher) return;
    await this.watcher.close();
    this.watcher = null;
  }

  getFileKey(filePath) {
    return path.basename(filePath, '.js');
  }

  /** 模块文件键（路径或文件名 → 不含 .js 的 basename） */
  static moduleFileKey(nameOrPath) {
    const base = path.basename(String(nameOrPath ?? ''));
    return base.endsWith('.js') ? base.slice(0, -3) : base;
  }
}
