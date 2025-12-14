import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

export default class StdinEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set()
    this.adapterName = 'stdin'
    this.MAX_PROCESSED_EVENTS = 1000
  }

  async init() {
    Bot.on('stdin.message', (e) => this.handleEvent(e, 'stdin.message'))
  }

  async handleEvent(e, eventType) {
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

  cleanupProcessedEvents() {
    if (this.processedEvents.size > this.MAX_PROCESSED_EVENTS) {
      const ids = Array.from(this.processedEvents)
      const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
      toRemove.forEach(id => this.processedEvents.delete(id))
    }
  }
}

