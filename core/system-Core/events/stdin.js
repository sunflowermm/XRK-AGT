import EventListenerBase from '#infrastructure/listener/base.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

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
    this.normalizeEvent(e)

    // 强制将 stdin 设置为主人
    e.isMaster = true

    await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    EventNormalizer.normalize(e, {
      defaultPostType: 'message',
      defaultMessageType: 'private',
      defaultSubType: 'friend',
      defaultUserId: 'stdin'
    })
    
    EventNormalizer.normalizeStdin(e)
    
    // 补充message数组（如果command存在但message为空）
    if (e.command && (!Array.isArray(e.message) || e.message.length === 0)) {
      e.message = [{ type: 'text', text: e.command }]
    }
  }
}

