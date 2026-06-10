import path from 'node:path';
import lodash from 'lodash';
import TaskerLoader from '#infrastructure/tasker/loader.js';
import BotUtil from '#utils/botutil.js';
import { FileLoader } from '#utils/file-loader.js';
import { LOADER_BATCH_SIZE } from '#utils/loader-constants.js';

class ListenerLoader {
  bot = null;

  async load(bot) {
    this.bot = bot;
    let eventCount = 0;

    const eventFiles = await FileLoader.getCoreSubDirFiles('events', {
      ext: '.js',
      recursive: false
    });

    if (eventFiles.length > 0) {
      BotUtil.makeLog('info', '加载监听事件中...', 'ListenerLoader');

      const loadEventFile = async (filePath) => {
        const file = path.basename(filePath);
        BotUtil.makeLog('debug', `加载监听事件: ${file}`, 'ListenerLoader');
        const listener = await FileLoader.importFresh(filePath);
        if (!listener.default) return 0;

        const instance = new listener.default();
        instance.bot = this.bot;

        if (typeof instance.init === 'function') {
          await instance.init();
          return 1;
        }

        const on = instance.once ? 'once' : 'on';
        if (lodash.isArray(instance.event)) {
          for (const type of instance.event) {
            const handler = instance[type] ? type : 'execute';
            this.bot[on](instance.prefix + type, instance[handler].bind(instance));
          }
        } else {
          const handler = instance[instance.event] ? instance.event : 'execute';
          this.bot[on](instance.prefix + instance.event, instance[handler].bind(instance));
        }
        return 1;
      };

      const results = await FileLoader.mapInBatches(eventFiles, LOADER_BATCH_SIZE, loadEventFile);
      for (const result of results) {
        if (result.status === 'fulfilled') eventCount += result.value;
        else BotUtil.makeLog('error', `监听事件加载错误: ${result.reason.message}`, 'ListenerLoader', result.reason);
      }
    }

    BotUtil.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');

    if (process.argv.includes('server')) {
      await this.loadAdapters();
    }
  }

  async loadAdapters() {
    BotUtil.makeLog('info', '加载 tasker 中...', 'ListenerLoader');
    await TaskerLoader.load(this.bot);

    if (this.bot.tasker.length === 0) {
      BotUtil.makeLog('warn', '未找到已注册的 tasker', 'ListenerLoader');
      return;
    }

    BotUtil.makeLog('info', '初始化 tasker 中...', 'ListenerLoader');
    let taskerCount = 0;
    let taskerErrorCount = 0;

    const initResults = await Promise.allSettled(
      this.bot.tasker.map(async (tasker) => {
        if (typeof tasker.load !== 'function') {
          BotUtil.makeLog('warn', `tasker 无效: ${tasker.name}(${tasker.id})`, 'ListenerLoader');
          return false;
        }
        BotUtil.makeLog('debug', `初始化 tasker: ${tasker.name}(${tasker.id})`, 'ListenerLoader');
        await tasker.load();
        return true;
      })
    );

    for (const result of initResults) {
      if (result.status === 'fulfilled' && result.value) taskerCount++;
      else if (result.status === 'rejected') {
        taskerErrorCount++;
        BotUtil.makeLog('error', `tasker 初始化错误: ${result.reason.message}`, 'ListenerLoader', result.reason);
      }
    }

    BotUtil.makeLog(
      'info',
      `初始化 tasker[${taskerCount}个]${taskerErrorCount > 0 ? `, 失败${taskerErrorCount}个` : ''}`,
      'ListenerLoader'
    );
  }
}

export default new ListenerLoader();
