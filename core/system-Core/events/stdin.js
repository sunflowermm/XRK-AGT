import EventListenerBase from '#infrastructure/listener/base.js'

export default class StdinEvent extends EventListenerBase {
  constructor() {
    super('stdin')
  }

  async init() {
    const bot = this.bot || Bot
    bot.on('stdin.message', (e) => this.handleEvent(e))
  }

  async handleEvent(e) {
    if (!e) return
    this.ensureEventId(e)
    if (!this.markProcessed(e)) return
    this.markAdapter(e, { isStdin: true })
    e.isMaster = true
    await this.plugins.deal(e)
  }
}

