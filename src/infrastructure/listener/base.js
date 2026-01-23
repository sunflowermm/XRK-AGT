import PluginsLoader from '#infrastructure/plugins/loader.js'

/**
 * 事件监听基类
 * 提供通用的去重、事件ID生成与 tasker 标记能力
 * tasker 特有的属性应在各自监听器中调用 markAdapter 传入
 */
export default class EventListenerBase {
  constructor(adapterName = '') {
    this.plugins = PluginsLoader
    this.processedEvents = new Set()
    this.adapterName = adapterName
    this.MAX_PROCESSED_EVENTS = 1000
    this.bot = null
  }

  /**
   * 确保事件ID存在
   * @param {Object} e - 事件对象
   * @returns {string} 事件ID
   */
  ensureEventId(e) {
    if (e.event_id) return e.event_id
    const postType = e.post_type || 'event'
    const randomId = Math.random().toString(36).substr(2, 9)
    e.event_id = `${this.adapterName || 'event'}_${postType}_${Date.now()}_${randomId}`
    return e.event_id
  }

  /**
   * 去重并记录处理过的事件
   * @param {Object} e - 事件对象
   * @returns {boolean} true 表示可继续处理；false 表示已处理过
   */
  markProcessed(e) {
    if (!e) return false
    const eventId = this.ensureEventId(e)
    const uniqueKey = `${this.adapterName || 'event'}:${eventId}`
    if (this.processedEvents.has(uniqueKey)) return false
    this.processedEvents.add(uniqueKey)
    this.cleanupProcessedEvents()
    return true
  }

  /**
   * 标记适配器信息
   * @param {Object} e - 事件对象
   * @param {Object} extraFlags - 额外的标记属性
   */
  markAdapter(e, extraFlags = {}) {
    if (!e) return
    if (this.adapterName && !e.tasker) {
      e.tasker = this.adapterName
    }
    if (extraFlags && Object.keys(extraFlags).length > 0) {
      Object.assign(e, extraFlags)
    }
  }

  /**
   * 清理已处理事件记录（防止内存泄漏）
   */
  cleanupProcessedEvents() {
    if (this.processedEvents.size <= this.MAX_PROCESSED_EVENTS) return
    const ids = Array.from(this.processedEvents)
    const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
    toRemove.forEach(id => this.processedEvents.delete(id))
  }
}

