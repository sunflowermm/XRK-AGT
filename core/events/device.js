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
    this.normalizeEvent(e)
    
    await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    // 标准化消息类型
    if (e.post_type === 'device' && e.event_type === 'message') {
      e.post_type = 'message'
    }
    
    // 确保 message 是数组
    if (!Array.isArray(e.message)) {
      if (e.message) {
        e.message = [{ type: 'text', text: String(e.message) }]
      } else {
        e.message = []
      }
    }
    
    // 确保 raw_message 存在
    if (!e.raw_message && Array.isArray(e.message) && e.message.length > 0) {
      e.raw_message = e.message
        .map(seg => {
          if (seg.type === 'text') return seg.text || ''
          return `[${seg.type}]`
        })
        .join('')
    }
    
    // 确保 raw_message 至少是空字符串
    if (!e.raw_message) {
      e.raw_message = e.text || e.msg || ''
    }
    
    // 设置 msg 字段（插件系统需要）
    if (!e.msg) {
      e.msg = e.raw_message || e.text || ''
    }
    
    // 确保 sender 对象存在
    if (!e.sender) {
      e.sender = {}
    }
    
    // 确保 sender.user_id 存在
    if (!e.sender.user_id && e.user_id) {
      e.sender.user_id = e.user_id
    }
    
    // 确保 sender.nickname 存在
    if (!e.sender.nickname) {
      e.sender.nickname = e.sender.user_id || 'device'
    }
    
    // 确保 message_type 存在
    if (!e.message_type) {
      e.message_type = e.group_id ? 'group' : 'private'
    }
  }
}

