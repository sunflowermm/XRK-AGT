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

  async handleEvent(e, eventType) {
    try {
      // 确保 bot 对象存在
      if (!e.bot && e.self_id) {
        e.bot = Bot[e.self_id]
      }
      
      // 如果没有bot对象，无法处理事件
      if (!e.bot) {
        Bot.makeLog("warn", `Bot对象不存在，忽略事件：${e.self_id}`, e.self_id)
        return
      }
      
      // 如果没有event_id，生成一个唯一的ID用于去重
      let eventId = e.event_id
      if (!eventId) {
        // 使用消息ID、时间戳和随机数生成唯一ID
        const messageId = e.message_id || ''
        const time = e.time || Math.floor(Date.now() / 1000)
        const randomId = Math.random().toString(36).substr(2, 9)
        eventId = `${this.adapterName}_${time}_${messageId}_${randomId}`
        e.event_id = eventId
      }
      
      const uniqueKey = `${this.adapterName}:${eventId}`
      if (this.processedEvents.has(uniqueKey)) {
        Bot.makeLog("debug", `事件已处理，跳过：${eventId}`, e.self_id)
        return
      }
      
      this.processedEvents.add(uniqueKey)
      this.cleanupProcessedEvents()
      
      e.adapter = this.adapterName
      e.isOneBot = true
      
      // 确保 post_type 存在，从事件类型中推断
      if (!e.post_type) {
        // 从事件类型中提取 post_type (onebot.message -> message)
        const parts = eventType.split('.')
        if (parts.length >= 2) {
          e.post_type = parts[1] // message, notice, request
        }
      }
      
      // 确保 time 字段存在
      if (!e.time) {
        e.time = Math.floor(Date.now() / 1000)
      }
      
      // 标准化消息事件
      if (e.post_type === 'message') {
        this.normalizeMessageEvent(e)
      }
      
      // 确保 reply 方法存在
      if (!e.reply && e.bot) {
        if (e.message_type === 'private' && e.user_id) {
          const friend = e.bot.pickFriend?.(e.user_id)
          if (friend && friend.sendMsg) {
            e.reply = async (msg) => {
              if (!msg) return false
              try {
                return await friend.sendMsg(msg)
              } catch (error) {
                Bot.makeLog("error", `回复消息失败: ${error.message}`, e.self_id)
                return false
              }
            }
          }
        } else if (e.message_type === 'group' && e.group_id && e.user_id) {
          const group = e.bot.pickGroup?.(e.group_id)
          if (group && group.sendMsg) {
            e.reply = async (msg) => {
              if (!msg) return false
              try {
                return await group.sendMsg(msg)
              } catch (error) {
                Bot.makeLog("error", `回复消息失败: ${error.message}`, e.self_id)
                return false
              }
            }
          }
        }
      }
      
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

