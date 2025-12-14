import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * 设备事件监听器
 * 监听所有device.*事件并分发给插件系统
 */
export default class DeviceEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重
  }

  /**
   * 监听所有device.*事件
   * 通过Bot.on注册事件监听
   */
  async init() {
    // 监听基础device事件
    Bot.on('device', (e) => this.handleEvent(e, 'device'))
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
      // 使用事件ID去重，避免重复处理
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
      e.adapter = 'device'
      e.isDevice = true
      
      // 分发给插件系统处理
      await this.plugins.deal(e)
    } catch (error) {
      logger.error('设备事件处理错误')
      logger.error(error)
    }
  }
}

