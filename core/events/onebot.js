import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * OneBot事件监听器
 * 监听所有onebot.*事件并分发给插件系统
 */
export default class OneBotEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重，避免Bot.em递归触发导致重复处理
  }

  /**
   * 监听所有onebot.*事件
   * 通过Bot.on注册事件监听
   */
  async init() {
    // 监听基础onebot事件（Bot.em会递归触发父级事件，我们只处理最具体的事件）
    // 使用once模式或者通过事件ID去重
    Bot.on('onebot.message', (e) => this.handleEvent(e, 'onebot.message'))
    Bot.on('onebot.notice', (e) => this.handleEvent(e, 'onebot.notice'))
    Bot.on('onebot.request', (e) => this.handleEvent(e, 'onebot.request'))
  }

  /**
   * 处理OneBot事件
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   */
  async handleEvent(e, eventType) {
    try {
      // 使用事件ID去重，避免Bot.em递归触发导致重复处理
      const eventId = e.event_id || `${eventType}_${Date.now()}_${Math.random()}`
      if (this.processedEvents.has(eventId)) {
        return
      }
      this.processedEvents.add(eventId)
      
      // 清理旧的事件ID（保留最近1000个）
      if (this.processedEvents.size > 1000) {
        const ids = Array.from(this.processedEvents)
        ids.slice(0, ids.length - 1000).forEach(id => this.processedEvents.delete(id))
      }
      
      // 设置事件来源标识
      e.adapter = 'onebot'
      e.isOneBot = true
      
      // 分发给插件系统处理
      await this.plugins.deal(e)
    } catch (error) {
      logger.error('OneBot事件处理错误')
      logger.error(error)
    }
  }
}

