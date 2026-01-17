import EventListenerBase from '#infrastructure/listener/base.js'
import { errorHandler, ErrorCodes } from '#utils/error-handler.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

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
   * 标准化事件基础字段（使用统一标准化器）
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   * @returns {boolean} 是否成功标准化
   */
  normalizeEventBase(e, eventType) {
    // 确保 bot 对象存在
    e.bot = e.bot || (e.self_id ? Bot[e.self_id] : null)
    if (!e.bot) {
      // warn: Bot对象不存在需要关注
      Bot.makeLog("warn", `Bot对象不存在，忽略事件：${e.self_id}`, e.self_id)
      return false
    }
    
    this.ensureEventId(e)
    
    if (!this.markProcessed(e)) {
      // debug: 事件去重是技术细节
      Bot.makeLog("debug", `事件已处理，跳过：${e.event_id}`, e.self_id)
      return false
    }
    
    // 设置 tasker 标识（原适配器）
    this.markAdapter(e, { isOneBot: true })
    
    // 使用统一标准化器
    EventNormalizer.normalize(e, {
      defaultPostType: 'message',
      defaultMessageType: e.group_id ? 'group' : 'private',
      defaultUserId: e.user_id,
      defaultSubType: e.group_id ? 'normal' : 'friend'
    })
    
    // OneBot特有标准化
    EventNormalizer.normalizeOneBot(e, eventType)
    
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
        // warn: 发送方法缺失需要关注
        Bot.makeLog("warn", `无法发送消息：找不到合适的发送方法`, e.self_id)
        return false
      } catch (error) {
        errorHandler.handle(
          error,
          { context: 'setupReplyMethod', selfId: e.self_id, code: ErrorCodes.SYSTEM_ERROR },
          true
        )
        // debug: 发送失败是技术细节
        Bot.makeLog("debug", `回复消息失败: ${error.message}`, e.self_id)
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
      errorHandler.handle(
        error,
        { context: 'handleEvent', eventType, selfId: e?.self_id, code: ErrorCodes.SYSTEM_ERROR },
        true
      )
      Bot.makeLog("error", `处理OneBot事件失败: ${error.message}`, e?.self_id, error)
    }
  }

  /**
   * 标准化消息事件（使用统一标准化器，保留OneBot特有的CQ码处理）
   */
  normalizeMessageEvent(e) {
    // 使用统一标准化器处理基础字段
    EventNormalizer.normalizeMessage(e)
    EventNormalizer.normalizeGroup(e)
    
    // OneBot特有的CQ码处理
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
      // 更新msg字段
      if (!e.msg) {
        e.msg = e.raw_message
      }
    }
    
    // 确保 self_id 存在
    if (!e.self_id && e.bot && e.bot.uin) {
      e.self_id = e.bot.uin
    }
    
    // 确保 user_id 存在
    if (!e.user_id && e.sender && e.sender.user_id) {
      e.user_id = e.sender.user_id
    }
  }

}

