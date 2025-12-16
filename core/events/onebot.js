import EventListenerBase from '#infrastructure/listener/base.js'

export default class OneBotEvent extends EventListenerBase {
  constructor() {
    super('onebot')
  }

  async init() {
    const bot = this.bot || Bot
    bot.on('onebot.message', (e) => this.handleEvent(e, 'onebot.message'))
    bot.on('onebot.notice', (e) => this.handleEvent(e, 'onebot.notice'))
    bot.on('onebot.request', (e) => this.handleEvent(e, 'onebot.request'))
  }

  /**
   * 标准化事件基础字段
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   * @returns {boolean} 是否成功标准化
   */
  normalizeEventBase(e, eventType) {
    // 确保 bot 对象存在
    e.bot = e.bot || (e.self_id ? Bot[e.self_id] : null)
    if (!e.bot) {
      Bot.makeLog("warn", `Bot对象不存在，忽略事件：${e.self_id}`, e.self_id)
      return false
    }
    
    this.ensureEventId(e)
    
    if (!this.markProcessed(e)) {
      Bot.makeLog("debug", `事件已处理，跳过：${e.event_id}`, e.self_id)
      return false
    }
    
    // 设置 tasker 标识（原适配器）
    this.markAdapter(e, { isOneBot: true })
    
    // 从事件类型推断 post_type
    if (!e.post_type) {
      const parts = eventType.split('.')
      if (parts.length >= 2) {
        e.post_type = parts[1]
      }
    }
    
    // 确保 time 字段存在
    e.time = e.time || Math.floor(Date.now() / 1000)
    
    return true
  }

  /**
   * 设置事件回复方法
   * @param {Object} e - 事件对象
   * 注意：此方法作为备用，优先由 OneBotEnhancer 插件设置正确的 reply 方法
   */
  setupReplyMethod(e) {
    // 如果已经有 reply 方法，不覆盖（可能由 OneBotEnhancer 插件设置）
    if (e.reply || !e.bot) return
    
    // 作为备用方案，尝试使用 group 或 friend 的 sendMsg
    // 注意：此时 group 和 friend 可能还未设置（由 OneBotEnhancer 设置）
    e.reply = async (msg = '', quote = false, data = {}) => {
      if (!msg) return false
      try {
        // 优先使用 group 的 sendMsg（群聊）
        if (e.group?.sendMsg) {
          return await e.group.sendMsg(msg)
        }
        // 其次使用 friend 的 sendMsg（私聊）
        if (e.friend?.sendMsg) {
          return await e.friend.sendMsg(msg)
        }
        // 最后尝试使用 tasker 的发送方法
        if (e.bot?.tasker) {
          const tasker = e.bot.tasker
          if (e.message_type === 'group' && e.group_id && tasker.sendGroupMsg) {
            return await tasker.sendGroupMsg({ ...e, group_id: e.group_id }, msg)
          }
          if (e.message_type === 'private' && e.user_id && tasker.sendFriendMsg) {
            return await tasker.sendFriendMsg({ ...e, user_id: e.user_id }, msg)
          }
        }
        Bot.makeLog("warn", `无法发送消息：找不到合适的发送方法`, e.self_id)
        return false
      } catch (error) {
        Bot.makeLog("error", `回复消息失败: ${error.message}`, e.self_id)
        return false
      }
    }
  }

  /**
   * 处理事件
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   */
  async handleEvent(e, eventType) {
    try {
      // 标准化基础字段
      if (!this.normalizeEventBase(e, eventType)) {
        return
      }
      
      // 标准化消息事件
      if (e.post_type === 'message') {
        this.normalizeMessageEvent(e)
        // 兜底 reply，防止增强插件未成功挂载
        this.setupReplyMethod(e)
      }
      
      // 注意：reply 方法由 OneBotEnhancer 插件设置（优先级1）
      // 这里不设置 reply，避免覆盖插件的正确实现
      
      // 交给插件系统处理
      await this.plugins.deal(e)
    } catch (error) {
      Bot.makeLog("error", `处理OneBot事件失败: ${error.message}`, e.self_id, error)
    }
  }

  /**
   * 标准化消息事件
   * 确保所有必要的字段都被正确设置
   */
  normalizeMessageEvent(e) {
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
          if (seg.type === 'at') return `[CQ:at,qq=${seg.qq || seg.user_id || ''}]`
          if (seg.type === 'image') return `[CQ:image,file=${seg.url || seg.file || ''}]`
          if (seg.type === 'face') return `[CQ:face,id=${seg.id || ''}]`
          if (seg.type === 'reply') return `[CQ:reply,id=${seg.id || ''}]`
          if (seg.type === 'record') return `[CQ:record,file=${seg.file || ''}]`
          if (seg.type === 'video') return `[CQ:video,file=${seg.file || ''}]`
          if (seg.type === 'file') return `[CQ:file,file=${seg.file || ''}]`
          return `[${seg.type}]`
        })
        .join('')
    }
    
    // 确保 raw_message 至少是空字符串
    if (!e.raw_message) {
      e.raw_message = ''
    }
    
    // 设置 msg 字段（插件系统需要）
    if (!e.msg) {
      e.msg = e.raw_message
    }
    
    // 确保 sender 对象存在
    if (!e.sender) {
      e.sender = {}
    }
    
    // 确保 sender.user_id 存在
    if (!e.sender.user_id && e.user_id) {
      e.sender.user_id = e.user_id
    }
    
    // 确保 message_type 存在
    if (!e.message_type) {
      e.message_type = e.group_id ? 'group' : 'private'
    }
    
    // 确保 sub_type 存在
    if (!e.sub_type) {
      e.sub_type = e.message_type === 'group' ? 'normal' : 'friend'
    }
    
    // 确保 user_id 存在
    if (!e.user_id && e.sender && e.sender.user_id) {
      e.user_id = e.sender.user_id
    }
    
    // 确保 self_id 存在
    if (!e.self_id && e.bot && e.bot.uin) {
      e.self_id = e.bot.uin
    }
  }

}

