import chokidar from 'chokidar';
import lodash from 'lodash';
import path from 'path';
import BotUtil from '#utils/botutil.js';
import paths from '#utils/paths.js';

const DEFAULT_AWAIT_WRITE_FINISH = {
  stabilityThreshold: 300,
  pollInterval: 100
};

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

  async watch(enable = true, options = {}) {
    if (!enable) {
      await this.stop();
      return;
    }
    if (this.watcher) return;

    const { dirs, onAdd, onChange, onUnlink } = options;
    const dirList = Array.isArray(dirs) ? dirs : dirs ? [dirs] : [];
    if (dirList.length === 0) return;

    this.watcher = chokidar.watch(dirList, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: this.awaitWriteFinish
    });

    const bind = (event, handler) => {
      if (!handler) return;
      this.watcher.on(event, lodash.debounce(async (filePath) => {
        if (!this.isValidFile(filePath)) return;
        try {
          if (event === 'add') paths.invalidateCoreCache();
          await handler(filePath);
        } catch (error) {
          BotUtil.makeLog('error', `热更新 ${event} 失败: ${filePath}`, this.loggerName, error);
        }
      }, this.debounceDelay));
    };

    bind('add', onAdd);
    bind('change', onChange);
    bind('unlink', onUnlink);
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
}
