import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * 设备事件监听器
 * 监听所有device.*事件并分发给插件系统
 * 
 * 事件流程：
 * 1. 设备适配器触发 Bot.em('device.message', event)
 * 2. 本监听器捕获事件并标准化
 * 3. 调用 plugins.deal(e) 分发给插件系统
 * 4. 插件系统通过 filtEvent 匹配插件（支持通用事件如 'message'）
 */
export default class DeviceEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重，避免重复处理
    this.adapterName = 'device'
    this.MAX_PROCESSED_EVENTS = 1000 // 最大保留事件数
  }

  /**
   * 初始化事件监听
   * 监听所有device.*事件
   */
  async init() {
    // 只监听最具体的事件类型，避免重复处理
    // 不监听 'device' 通用事件，只监听具体类型（message/notice/request）
    Bot.on('device.message', (e) => this.handleEvent(e, 'device.message'))
    Bot.on('device.notice', (e) => this.handleEvent(e, 'device.notice'))
    Bot.on('device.request', (e) => this.handleEvent(e, 'device.request'))
  }

  /**
   * 处理设备事件
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   */
  async handleEvent(e, eventType) {
    try {
      // 确保只处理本适配器的事件
      if (e.adapter && e.adapter !== this.adapterName && !e.isDevice) {
        return
      }

      // 使用适配器+事件ID作为唯一标识去重
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
      e.isDevice = true
      
      // 分发给插件系统处理
      // 插件系统会通过 filtEvent 匹配插件，支持：
      // - 特定事件: 'device.message' 只匹配设备的 message
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

