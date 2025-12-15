import EventListenerBase from '#infrastructure/listener/base.js'

export default class DeviceEvent extends EventListenerBase {
  constructor() {
    super('device')
  }

  async init() {
    const bot = this.bot || Bot
    bot.on('device.message', (e) => this.handleEvent(e))
    bot.on('device.notice', (e) => this.handleEvent(e))
    bot.on('device.request', (e) => this.handleEvent(e))
  }

  async handleEvent(e) {
    if (!e) return

    this.ensureEventId(e)
    if (!this.markProcessed(e)) return

    this.markAdapter(e, { isDevice: true })
    await this.plugins.deal(e)
  }
}

