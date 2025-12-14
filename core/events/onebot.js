import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * OneBot事件监听器
 * 监听所有onebot.*事件并分发给插件系统
 * 
 * 事件流程：
 * 1. OneBot适配器触发 Bot.em('onebot.message', event)
 * 2. 本监听器捕获事件并标准化
 * 3. 调用 plugins.deal(e) 分发给插件系统
 * 4. 插件系统通过 filtEvent 匹配插件（支持通用事件如 'message'）
 */
export default class OneBotEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重，避免Bot.em递归触发导致重复处理
    this.adapterName = 'onebot'
    this.MAX_PROCESSED_EVENTS = 1000 // 最大保留事件数
  }

  /**
   * 初始化事件监听
   * 监听所有onebot.*事件
   */
  async init() {
    // 只监听最具体的事件类型，避免重复处理
    // Bot.em 可能会递归触发父级事件，我们通过去重机制避免重复处理
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
      // 确保只处理本适配器的事件
      if (e.adapter && e.adapter !== this.adapterName && !e.isOneBot) {
        return
      }

      // 使用适配器+事件ID作为唯一标识去重
      // 避免 Bot.em 递归触发导致重复处理
      const eventId = e.event_id || `${eventType}_${Date.now()}_${Math.random()}`
      const uniqueKey = `${this.adapterName}:${eventId}`
      
      if (this.processedEvents.has(uniqueKey)) {
        return
      }
      this.processedEvents.add(uniqueKey)
      
      // 清理旧的事件ID（保留最近N个）
      this.cleanupProcessedEvents()
      
      // 设置事件来源标识
      e.adapter = this.adapterName
      e.isOneBot = true
      
      // 分发给插件系统处理
      // 插件系统会通过 filtEvent 匹配插件，支持：
      // - 特定事件: 'onebot.message' 只匹配 OneBot 的 message
      // - 通用事件: 'message' 匹配所有适配器的 message
      await this.plugins.deal(e)
    } catch (error) {
      logger.error(`[${this.adapterName}] 事件处理错误: ${error.message}`)
      logger.error(error)
    }
  }

  /**
   * 清理已处理事件记录
   * 保留最近的事件，避免内存泄漏
   */
  cleanupProcessedEvents() {
    if (this.processedEvents.size > this.MAX_PROCESSED_EVENTS) {
      const ids = Array.from(this.processedEvents)
      const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
      toRemove.forEach(id => this.processedEvents.delete(id))
    }
  }
}

