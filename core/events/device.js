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
    const eventId = e.event_id
    if (!eventId) return
    
    const uniqueKey = `${this.adapterName}:${eventId}`
    if (this.processedEvents.has(uniqueKey)) return
    
    this.processedEvents.add(uniqueKey)
    this.cleanupProcessedEvents()
    
    e.adapter = this.adapterName
    e.isDevice = true
    
    await this.plugins.deal(e)
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

