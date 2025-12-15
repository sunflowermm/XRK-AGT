import PluginsLoader from '#infrastructure/plugins/loader.js'

/**
 * 事件监听基类
 * 提供通用的去重、事件ID生成与适配器标记能力
 * 适配器特有的属性应在各自监听器中调用 markAdapter 传入
 */
export default class EventListenerBase {
  constructor(adapterName = '') {
    this.plugins = PluginsLoader
    this.processedEvents = new Set()
    this.adapterName = adapterName
    this.MAX_PROCESSED_EVENTS = 1000
    this.bot = null
  }

  ensureEventId(e) {
    if (e.event_id) return e.event_id
    const postType = e.post_type || 'event'
    const randomId = Math.random().toString(36).substr(2, 9)
    e.event_id = `${this.adapterName || 'event'}_${postType}_${Date.now()}_${randomId}`
    return e.event_id
  }

  /**
   * 去重并记录处理过的事件
   * @returns {boolean} true 表示可继续处理；false 表示已处理过
   */
  markProcessed(e) {
    const eventId = this.ensureEventId(e)
    const uniqueKey = `${this.adapterName || 'event'}:${eventId}`
    if (this.processedEvents.has(uniqueKey)) return false
    this.processedEvents.add(uniqueKey)
    this.cleanupProcessedEvents()
    return true
  }

  markAdapter(e, extraFlags = {}) {
    if (this.adapterName && !e.adapter) {
      e.adapter = this.adapterName
    }
    Object.assign(e, extraFlags)
  }

  cleanupProcessedEvents() {
    if (this.processedEvents.size <= this.MAX_PROCESSED_EVENTS) return
    const ids = Array.from(this.processedEvents)
    const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
    toRemove.forEach(id => this.processedEvents.delete(id))
  }
}


