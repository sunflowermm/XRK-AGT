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
    
    // web客户端默认设置为主人
    if (e.device_type === 'web' || e.isMaster === true) {
      e.isMaster = true
    }
    
    await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    EventNormalizer.normalize(e, {
      defaultPostType: 'message',
      defaultMessageType: e.group_id ? 'group' : 'private',
      defaultUserId: e.device_id || e.user_id || 'device'
    })
    
    EventNormalizer.normalizeDevice(e)
    
    // 补充device特有的sender信息（仅在未设置时）
    if (!e.sender.nickname && e.device_name) {
      e.sender.nickname = e.device_name
      e.sender.card = e.sender.card || e.sender.nickname
    }
  }
}

