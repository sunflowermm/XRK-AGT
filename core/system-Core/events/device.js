import EventListenerBase from '#infrastructure/listener/base.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

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
    this.normalizeEvent(e)
    
    await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    // 使用统一标准化器
    EventNormalizer.normalize(e, {
      defaultPostType: 'message',
      defaultMessageType: e.group_id ? 'group' : 'private',
      defaultUserId: e.device_id || e.user_id || 'device'
    })
    
    // Device特有标准化
    EventNormalizer.normalizeDevice(e)
    
    // 确保 sender.nickname（Device特有）
    if (!e.sender.nickname) {
      e.sender.nickname = e.sender.user_id || 'device'
    }
  }
}

