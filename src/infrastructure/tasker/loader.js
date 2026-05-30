import path from 'node:path';
import { pathToFileURL } from 'node:url';
import BotUtil from '#utils/botutil.js';
import { FileLoader } from '#utils/file-loader.js';

// Tasker 加载器
class TaskerLoader {
  constructor() {
    this.loggerNs = 'TaskerLoader';
  }

  async load(bot = Bot) {
    global.Bot = bot;
    globalThis.Bot = bot;

    const summary = {
      scanned: 0,
      loaded: 0,
      failed: 0,
      registered: 0,
      errors: []
    };

    try {
      const files = await this.getAdapterFiles();
      summary.scanned = files.length;

      if (!files.length) {
        BotUtil.makeLog('info', '未找到 tasker 文件', this.loggerNs);
        return summary;
      }

      const adapterCountBefore = bot?.tasker?.length ?? 0;

      await Promise.allSettled(
        files.map(async ({ name, href }) => {
          try {
            BotUtil.makeLog('debug', `导入 tasker 文件: ${name}`, this.loggerNs);
            const mod = await import(href);
            if (typeof mod.register === 'function') {
              await mod.register(bot);
            }
            summary.loaded += 1;
          } catch (err) {
            summary.failed += 1;
            summary.errors.push({ name, message: err.message });
            BotUtil.makeLog('error', `导入 tasker 失败: ${name}`, this.loggerNs, err);
            BotUtil.makeLog('warn', `[TaskerLoader] ${name} 错误: ${err.message}`, this.loggerNs);
            if (err.stack) BotUtil.makeLog('warn', `[TaskerLoader] ${name} 堆栈:\n${err.stack}`, this.loggerNs);
            if (err.cause) BotUtil.makeLog('warn', `[TaskerLoader] ${name} cause: ${err.cause?.message ?? String(err.cause)}`, this.loggerNs);
          }
        })
      );

      summary.registered = (bot?.tasker?.length ?? 0) - adapterCountBefore;

      BotUtil.makeLog(
        summary.failed ? 'warn' : 'info',
        `Tasker 加载完成: 成功${summary.loaded}个, 注册${summary.registered}个${summary.failed ? `, 失败${summary.failed}个` : ''}`,
        this.loggerNs
      );

      return summary;
    } catch (error) {
      BotUtil.makeLog('error', 'Tasker 加载失败', this.loggerNs, error);
      summary.failed += 1;
      summary.errors.push({ name: 'internal', message: error.message });
      return summary;
    }
  }

  async getAdapterFiles() {
    try {
      const filePaths = await FileLoader.getCoreSubDirFiles('tasker', {
        ext: '.js',
        recursive: false
      });

      return filePaths.map((filePath) => ({
        name: path.basename(filePath),
        href: pathToFileURL(filePath).href,
        core: path.basename(path.dirname(path.dirname(filePath)))
      }));
    } catch (error) {
      BotUtil.makeLog('error', `获取 tasker 文件列表失败`, this.loggerNs, error);
      return [];
    }
  }
}

export default new TaskerLoader();
