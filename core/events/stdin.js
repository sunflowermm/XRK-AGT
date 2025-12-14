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
    // 只监听最具体的事件类型，避免重复处理
    Bot.on('stdin.message', (e) => this.handleEvent(e, 'stdin.message'))
    Bot.on('stdin.command', (e) => this.handleEvent(e, 'stdin.command'))
    // stdin.output 是输出事件，不需要分发给插件系统
  }

  /**
   * 处理Stdin事件
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   */
  async handleEvent(e, eventType) {
    try {
      // 确保只处理本适配器的事件
      if (e.adapter && e.adapter !== this.adapterName && !e.isStdin) {
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
      e.isStdin = true
      
      // 标准化事件对象结构
      this.normalizeEvent(e)
      
      // 分发给插件系统处理
      // 插件系统会通过 filtEvent 匹配插件，支持：
      // - 特定事件: 'stdin.message' 只匹配 stdin 的 message
      // - 通用事件: 'message' 匹配所有适配器的 message
      await this.plugins.deal(e)
    } catch (error) {
      logger.error(`[${this.adapterName}] 事件处理错误: ${error.message}`)
      logger.error(error)
    }
  }

  /**
   * 标准化事件对象
   * 确保事件对象有完整的结构，便于插件系统处理
   */
  normalizeEvent(e) {
    // 确保基础事件类型
    if (!e.post_type) {
      e.post_type = 'message'
    }
    if (!e.message_type) {
      e.message_type = 'private'
    }
    if (!e.sub_type) {
      e.sub_type = 'friend'
    }
    
    // 确保 sender 对象存在且完整
    if (!e.sender) {
      e.sender = {}
    }
    if (!e.sender.user_id) {
      e.sender.user_id = e.user_id || 'stdin'
    }
    if (!e.sender.nickname) {
      e.sender.nickname = e.sender.user_id
    }
    if (!e.sender.card) {
      e.sender.card = e.sender.nickname
    }
    
    // 如果事件有command字段，转换为标准消息事件格式
    if (e.command && !e.raw_message) {
      e.raw_message = e.command
      e.msg = e.command
      if (!e.message) {
        e.message = [{ type: 'text', text: e.command }]
      }
    }
    
    // 确保 raw_message 和 msg 存在
    if (!e.raw_message && e.message) {
      e.raw_message = Array.isArray(e.message) 
        ? e.message.map(m => m.type === 'text' ? m.text : `[${m.type}]`).join('')
        : String(e.message)
    }
    if (!e.msg) {
      e.msg = e.raw_message || ''
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

