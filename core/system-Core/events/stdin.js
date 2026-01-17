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

    await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    // 使用统一标准化器
    EventNormalizer.normalize(e, {
      defaultPostType: 'message',
      defaultMessageType: 'private',
      defaultSubType: 'friend',
      defaultUserId: 'stdin'
    })
    
    // Stdin特有标准化
    EventNormalizer.normalizeStdin(e)
    
    // Stdin特有：处理command字段
    if (e.command && !e.raw_message) {
      e.raw_message = e.command
      e.msg = e.command
      e.message = e.message || [{ type: 'text', text: e.command }]
    }
    
    // 确保sender.card（Stdin特有）
    if (!e.sender.card) {
      e.sender.card = e.sender.nickname
    }
  }
}

