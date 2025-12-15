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
}

