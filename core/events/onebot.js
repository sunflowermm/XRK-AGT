import PluginsLoader from '../../src/infrastructure/plugins/loader.js'

export default class OneBotEvent {
  constructor() {
    this.plugins = PluginsLoader
    this.processedEvents = new Set()
    this.adapterName = 'onebot'
    this.MAX_PROCESSED_EVENTS = 1000
  }

  async init() {
    Bot.on('onebot.message', (e) => this.handleEvent(e, 'onebot.message'))
    Bot.on('onebot.notice', (e) => this.handleEvent(e, 'onebot.notice'))
    Bot.on('onebot.request', (e) => this.handleEvent(e, 'onebot.request'))
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
    
    // 生成或使用现有 event_id
    if (!e.event_id) {
      const messageId = e.message_id || ''
      const time = e.time || Math.floor(Date.now() / 1000)
      const randomId = Math.random().toString(36).substr(2, 9)
      e.event_id = `${this.adapterName}_${time}_${messageId}_${randomId}`
    }
    
    // 事件去重检查
    const uniqueKey = `${this.adapterName}:${e.event_id}`
    if (this.processedEvents.has(uniqueKey)) {
      Bot.makeLog("debug", `事件已处理，跳过：${e.event_id}`, e.self_id)
      return false
    }
    
    this.processedEvents.add(uniqueKey)
    this.cleanupProcessedEvents()
    
    // 设置适配器标识
    e.adapter = this.adapterName
    e.isOneBot = true
    
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
   */
  setupReplyMethod(e) {
    if (e.reply || !e.bot) return
    
    const createReply = (sendMsgFunc) => {
      return async (msg) => {
        if (!msg) return false
        try {
          return await sendMsgFunc(msg)
        } catch (error) {
          Bot.makeLog("error", `回复消息失败: ${error.message}`, e.self_id)
          return false
        }
      }
    }
    
    if (e.message_type === 'private' && e.user_id) {
      const friend = e.bot.pickFriend?.(e.user_id)
      if (friend?.sendMsg) {
        e.reply = createReply((msg) => friend.sendMsg(msg))
      }
    } else if (e.message_type === 'group' && e.group_id) {
      const group = e.bot.pickGroup?.(e.group_id)
      if (group?.sendMsg) {
        e.reply = createReply((msg) => group.sendMsg(msg))
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
      }
      
      // 设置回复方法
      this.setupReplyMethod(e)
      
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
    
    // 设置标志
    e.isGroup = e.message_type === 'group'
    e.isPrivate = e.message_type === 'private'
    
    // 确保 user_id 存在
    if (!e.user_id && e.sender && e.sender.user_id) {
      e.user_id = e.sender.user_id
    }
    
    // 确保 self_id 存在
    if (!e.self_id && e.bot && e.bot.uin) {
      e.self_id = e.bot.uin
    }
  }

  cleanupProcessedEvents() {
    if (this.processedEvents.size > this.MAX_PROCESSED_EVENTS) {
      const ids = Array.from(this.processedEvents)
      const toRemove = ids.slice(0, ids.length - this.MAX_PROCESSED_EVENTS)
      toRemove.forEach(id => this.processedEvents.delete(id))
    }
  }
}

