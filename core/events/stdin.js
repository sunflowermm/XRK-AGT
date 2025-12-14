import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

/**
 * Stdin事件监听器
 * 监听所有stdin.*事件并分发给插件系统
 * 
 * 事件流程：
 * 1. 适配器触发 Bot.em('stdin.message', event)
 * 2. 本监听器捕获事件并标准化
 * 3. 调用 plugins.deal(e) 分发给插件系统
 * 4. 插件系统通过 filtEvent 匹配插件（支持通用事件如 'message'）
 */
export default class StdinEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set() // 用于去重，避免重复处理
    this.adapterName = 'stdin'
    this.MAX_PROCESSED_EVENTS = 1000 // 最大保留事件数
  }

  /**
   * 初始化事件监听
   * 监听所有stdin.*事件
   */
  async init() {
    // 只监听message事件，command事件已废弃
    Bot.on('stdin.message', (e) => this.handleEvent(e, 'stdin.message'))
  }

  /**
   * 处理Stdin事件
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   */
  async handleEvent(e, eventType) {
    // 使用事件ID去重，确保每个事件只处理一次
    const eventId = e.event_id
    if (!eventId) return
    
    const uniqueKey = `${this.adapterName}:${eventId}`
    if (this.processedEvents.has(uniqueKey)) return
    
    this.processedEvents.add(uniqueKey)
    this.cleanupProcessedEvents()
    
    e.adapter = this.adapterName
    e.isStdin = true
    this.normalizeEvent(e)
    
    await this.plugins.deal(e)
  }

  /**
   * 标准化事件对象
   */
  normalizeEvent(e) {
    e.post_type = e.post_type || 'message'
    e.message_type = e.message_type || 'private'
    e.sub_type = e.sub_type || 'friend'
    
    e.sender = e.sender || {}
    e.sender.user_id = e.sender.user_id || e.user_id || 'stdin'
    e.sender.nickname = e.sender.nickname || e.sender.user_id
    e.sender.card = e.sender.card || e.sender.nickname
    
    if (e.command && !e.raw_message) {
      e.raw_message = e.command
      e.msg = e.command
      e.message = e.message || [{ type: 'text', text: e.command }]
    }
    
    if (!e.raw_message && e.message) {
      e.raw_message = Array.isArray(e.message) 
        ? e.message.map(m => m.type === 'text' ? m.text : `[${m.type}]`).join('')
        : String(e.message)
    }
    e.msg = e.msg || e.raw_message || ''
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

