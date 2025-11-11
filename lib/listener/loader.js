import fs from "node:fs/promises"
import lodash from "lodash"

/**
 * 加载监听事件
 */
class ListenerLoader {
  /**
   * 监听事件加载
   */
  async load() {
    Bot.makeLog('info', "加载监听事件中...", 'ListenerLoader');
    let eventCount = 0
    
    try {
      const files = await fs.readdir("./plugins/events")
      const eventFiles = files.filter(file => file.endsWith(".js"))
      
      for (const file of eventFiles) {
        Bot.makeLog('debug', `加载监听事件 ${file}`, 'ListenerLoader');
        try {
          const listener = await import(`../../plugins/events/${file}`)
          if (!listener.default) continue
          
          const instance = new listener.default()
          const on = instance.once ? "once" : "on"

          if (lodash.isArray(instance.event)) {
            instance.event.forEach((type) => {
              const handler = instance[type] ? type : "execute"
              Bot[on](instance.prefix + type, instance[handler].bind(instance))
            })
          } else {
            const handler = instance[instance.event] ? instance.event : "execute"
            Bot[on](instance.prefix + instance.event, instance[handler].bind(instance))
          }
          eventCount++
        } catch (err) {
          Bot.makeLog('error', `监听事件加载错误 ${file}`, 'ListenerLoader', err);
        }
      }
    } catch (error) {
      Bot.makeLog('error', "加载事件目录失败", 'ListenerLoader', error);
    }

    Bot.makeLog('info', `加载监听事件[${eventCount}个]`, 'ListenerLoader');

    if (process.argv.includes("server")) {
      Bot.makeLog('info', "加载适配器中...", 'ListenerLoader');
      let adapterCount = 0
      for (const adapter of Bot.adapter) {
        try {
          Bot.makeLog('debug', `加载适配器 ${adapter.name}(${adapter.id})`, 'ListenerLoader');
          await adapter.load()
          adapterCount++
        } catch (err) {
          Bot.makeLog('error', `适配器加载错误 ${adapter.name}(${adapter.id})`, 'ListenerLoader', err)
        }
      }
      Bot.makeLog('info', `加载适配器[${adapterCount}个]`, 'ListenerLoader');
    } else { }
  }
}

export default new ListenerLoader()