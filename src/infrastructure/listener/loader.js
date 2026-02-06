import path from "node:path"
import lodash from "lodash"
import TaskerLoader from "#infrastructure/tasker/loader.js"
import BotUtil from "#utils/botutil.js";
import paths from '#utils/paths.js';

/**
 * 加载监听事件和适配器
 */
class ListenerLoader {
  /**
   * 监听事件和 tasker 加载
   */
  async load(bot) {
    this.bot = bot;
    // 步骤1: 加载监听事件
    BotUtil.makeLog('info', "加载监听事件中...", 'ListenerLoader');
    let eventCount = 0
    
    try {
      // 获取所有 core 目录下的 events 目录
      const eventsDirs = await paths.getCoreSubDirs('events')
      
      // 如果没有 events 目录，说明开发者可能不开发事件监听器，这是正常的
      if (eventsDirs.length === 0) {
        BotUtil.makeLog('info', `未找到事件目录，跳过加载`, 'ListenerLoader');
        BotUtil.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');
        if (process.argv.includes("server")) {
          await this.loadAdapters();
        }
        return;
      }
      
      // 加载所有 events 目录中的文件
      const { FileLoader } = await import('#utils/file-loader.js');
      for (const eventsDir of eventsDirs) {
        try {
          const files = await FileLoader.readFiles(eventsDir, {
            ext: '.js',
            recursive: false,
            ignore: ['.', '_']
          });
          
          for (const filePath of files) {
            const file = path.basename(filePath);
            BotUtil.makeLog('debug', `加载监听事件: ${file}`, 'ListenerLoader');
            try {
              const relativePath = path.relative(paths.root, filePath);
              const listener = await import(`../../../${relativePath.replace(/\\/g, '/')}`);
              if (!listener.default) continue;
              
              const instance = new listener.default();
              instance.bot = this.bot;
              
              if (typeof instance.init === 'function') {
                await instance.init();
                eventCount++;
              } else {
                const on = instance.once ? "once" : "on";
                if (lodash.isArray(instance.event)) {
                  instance.event.forEach((type) => {
                    const handler = instance[type] ? type : "execute";
                    this.bot[on](instance.prefix + type, instance[handler].bind(instance));
                  });
                } else {
                  const handler = instance[instance.event] ? instance.event : "execute";
                  this.bot[on](instance.prefix + instance.event, instance[handler].bind(instance));
                }
                eventCount++;
              }
            } catch (err) {
              BotUtil.makeLog('error', `监听事件加载错误: ${file}`, 'ListenerLoader', err);
            }
          }
        } catch (err) {
          BotUtil.makeLog('warn', `读取事件目录失败: ${eventsDir}`, 'ListenerLoader');
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', "加载事件目录失败", 'ListenerLoader', error);
      throw error;
    }

    BotUtil.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');

    // 步骤2: 加载 tasker（仅在服务器模式下）
    if (process.argv.includes("server")) {
      await this.loadAdapters();
    }
  }

  async loadAdapters() {
    if (!this.bot) {
      BotUtil.makeLog('error', "Bot 实例未初始化", 'ListenerLoader');
      return;
    }

    BotUtil.makeLog('info', "加载 tasker 中...", 'ListenerLoader');
    await TaskerLoader.load(this.bot);

    BotUtil.makeLog('info', "初始化 tasker 中...", 'ListenerLoader');
    let taskerCount = 0
    let taskerErrorCount = 0

    if (!this.bot.tasker || this.bot.tasker.length === 0) {
      BotUtil.makeLog('warn', "未找到已注册的 tasker", 'ListenerLoader');
      return;
    }

    for (const tasker of this.bot.tasker) {
      try {
        if (!tasker || typeof tasker.load !== 'function') {
          BotUtil.makeLog('warn', `tasker 无效: ${tasker?.name || 'unknown'}(${tasker?.id || 'unknown'})`, 'ListenerLoader');
          continue
        }

        BotUtil.makeLog('debug', `初始化 tasker: ${tasker.name}(${tasker.id})`, 'ListenerLoader');
        await tasker.load()
        taskerCount++
      } catch (err) {
        BotUtil.makeLog('error', `tasker 初始化错误: ${tasker?.name || 'unknown'}(${tasker?.id || 'unknown'})`, 'ListenerLoader', err)
        taskerErrorCount++
      }
    }

    BotUtil.makeLog('info', `初始化 tasker[${taskerCount}个]${taskerErrorCount > 0 ? `, 失败${taskerErrorCount}个` : ''}`, 'ListenerLoader');
  }
}

export default new ListenerLoader()
