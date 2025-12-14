import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * Stdin事件监听器
 * 监听所有stdin.*事件并分发给插件系统
 */
export default class StdinEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重
  }

  /**
   * 监听所有stdin.*事件
   * 通过Bot.on注册事件监听
   */
  async init() {
    // 监听基础stdin事件
    Bot.on('stdin.command', (e) => this.handleEvent(e, 'stdin.command'))
    Bot.on('stdin.output', (e) => this.handleEvent(e, 'stdin.output'))
  }

  /**
   * 处理Stdin事件
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
      e.adapter = 'stdin'
      e.isStdin = true
      
      // 如果事件有command字段，转换为标准消息事件格式
      if (e.command && !e.post_type) {
        e.post_type = 'message'
        e.message_type = 'private'
        e.sub_type = 'friend'
        e.raw_message = e.command
        e.msg = e.command
        if (!e.message) {
          e.message = [{ type: 'text', text: e.command }]
        }
      }
      
      // 分发给插件系统处理
      await this.plugins.deal(e)
    } catch (error) {
      logger.error('Stdin事件处理错误')
      logger.error(error)
    }
  }
}

