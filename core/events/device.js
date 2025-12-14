import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

export default class DeviceEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set()
    this.adapterName = 'device'
    this.MAX_PROCESSED_EVENTS = 1000
  }

  async init() {
    Bot.on('device.message', (e) => this.handleEvent(e, 'device.message'))
    Bot.on('device.notice', (e) => this.handleEvent(e, 'device.notice'))
    Bot.on('device.request', (e) => this.handleEvent(e, 'device.request'))
  }

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

  cleanupProcessedEvents() {
    if (this.processedEvents.size > this.MAX_PROCESSED_EVENTS) {
      const ids = Array.from(this.processedEvents)
      const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
      toRemove.forEach(id => this.processedEvents.delete(id))
    }
  }
}

