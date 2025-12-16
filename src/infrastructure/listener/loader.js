import fs from "node:fs/promises"
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
      const eventsDir = paths.coreEvents
      try {
        await fs.access(eventsDir)
      } catch {
        BotUtil.makeLog('warn', `事件目录不存在: ${eventsDir}，跳过加载`, 'ListenerLoader');
        BotUtil.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');
        if (process.argv.includes("server")) {
          await this.loadAdapters(this.bot);
        }
        return;
      }
      
      const files = await fs.readdir(eventsDir)
      const eventFiles = files.filter(file => file.endsWith(".js"))
      
      for (const file of eventFiles) {
        BotUtil.makeLog('debug', `加载监听事件: ${file}`, 'ListenerLoader');
        try {
          const listener = await import(`#core/events/${file}`)
          if (!listener.default) continue
          
          const instance = new listener.default()
          // 将全局 bot 注入监听器实例，避免依赖未初始化的全局 Bot
          instance.bot = this.bot
          
          // 新的事件系统：onebot.js和device.js使用init方法
          if (typeof instance.init === 'function') {
            await instance.init()
            eventCount++
          } else {
            // 向后兼容旧的事件监听器
            const on = instance.once ? "once" : "on"

            if (lodash.isArray(instance.event)) {
              instance.event.forEach((type) => {
                const handler = instance[type] ? type : "execute"
                bot[on](instance.prefix + type, instance[handler].bind(instance))
              })
            } else {
              const handler = instance[instance.event] ? instance.event : "execute"
              bot[on](instance.prefix + instance.event, instance[handler].bind(instance))
            }
            eventCount++
          }
        } catch (err) {
          BotUtil.makeLog('error', `监听事件加载错误: ${file}`, 'ListenerLoader', err);
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
    await TaskerLoader.load(this.bot ?? Bot)

    BotUtil.makeLog('info', "初始化 tasker 中...", 'ListenerLoader');
    let taskerCount = 0
    let taskerErrorCount = 0

    if (Bot.tasker.length === 0) {
      BotUtil.makeLog('warn', "未找到已注册的 tasker", 'ListenerLoader');
      return;
    }

    for (const tasker of Bot.tasker) {
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

    BotUtil.makeLog('info', `加载 tasker[${taskerCount}个]${taskerErrorCount > 0 ? `, 失败${taskerErrorCount}个` : ''}`, 'ListenerLoader');
  }
}

export default new ListenerLoader()
