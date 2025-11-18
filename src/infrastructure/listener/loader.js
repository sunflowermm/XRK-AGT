import fs from "node:fs/promises"
import lodash from "lodash"
import AdapterLoader from "#infrastructure/adapter/loader.js"
import BotUtil from "#utils/botutil.js";
import paths from '#utils/paths.js';

/**
 * 加载监听事件和适配器
 */
class ListenerLoader {
  /**
   * 监听事件和适配器加载
   */
  async load(bot) {
    this.bot = bot;
    // 步骤1: 加载监听事件
    BotUtil.makeLog('info', "加载监听事件中...", 'ListenerLoader');
    let eventCount = 0
    
    try {
      const eventsDir = paths.coreEvents
      const eventsDir = paths.coreEvents
      try {
        await fs.access(eventsDir)
        const files = await fs.readdir(eventsDir)
        const eventFiles = files.filter(file => file.endsWith(".js"))

        for (const file of eventFiles) {
          BotUtil.makeLog('debug', `加载监听事件: ${file}`, 'ListenerLoader');
          try {
            const listener = await import(`#core/events/${file}`)
            if (!listener.default) continue

            const instance = new listener.default()
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
          } catch (err) {
            BotUtil.makeLog('error', `监听事件加载错误: ${file}`, 'ListenerLoader', err);
          }
        }
      } catch (error) {
        // 如果目录不存在，则记录警告，否则记录错误
        if (error.code === 'ENOENT') {
          BotUtil.makeLog('warn', `事件目录不存在: ${eventsDir}，跳过加载`, 'ListenerLoader');
        } else {
          BotUtil.makeLog('error', "加载事件目录失败", 'ListenerLoader', error);
          throw error;
        }
      }
    } catch (error) {
      BotUtil.makeLog('error', "加载事件目录失败", 'ListenerLoader', error);
      throw error;
    }

    BotUtil.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');

    // 步骤2: 加载适配器（仅在服务器模式下）
    if (process.argv.includes("server")) {
      await this.loadAdapters(bot);
    }
  }

  async loadAdapters(bot) {
    await AdapterLoader.load(bot ?? Bot)

    BotUtil.makeLog('info', "初始化适配器中...", 'ListenerLoader');
    let adapterCount = 0
    let adapterErrorCount = 0

    if (Bot.adapter.length === 0) {
      BotUtil.makeLog('warn', "未找到已注册的适配器", 'ListenerLoader');
      return;
    }

    for (const adapter of Bot.adapter) {
      try {
        if (!adapter || typeof adapter.load !== 'function') {
          BotUtil.makeLog('warn', `适配器无效: ${adapter?.name || 'unknown'}(${adapter?.id || 'unknown'})`, 'ListenerLoader');
          continue
        }

        BotUtil.makeLog('debug', `初始化适配器: ${adapter.name}(${adapter.id})`, 'ListenerLoader');
        await adapter.load()
        adapterCount++
      } catch (err) {
        BotUtil.makeLog('error', `适配器初始化错误: ${adapter?.name || 'unknown'}(${adapter?.id || 'unknown'})`, 'ListenerLoader', err)
        adapterErrorCount++
      }
    }

    BotUtil.makeLog('info', `加载适配器[${adapterCount}个]${adapterErrorCount > 0 ? `, 失败${adapterErrorCount}个` : ''}`, 'ListenerLoader');
  }
}

export default new ListenerLoader()
