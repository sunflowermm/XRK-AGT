/**
 * @file EventBuilder.js
 * @description 规范化事件对象构建器
 * @author XRK
 * @copyright 2025 XRK Studio
 * @license MIT
 * 
 * 提供标准化的事件对象构建方法，确保所有适配器生成的事件对象具有统一的结构
 */

/**
 * 规范化事件对象构建器
 * @class EventBuilder
 */
export default class EventBuilder {
  /**
   * 构建标准化的事件对象
   * @param {Object} rawEvent - 原始事件对象（来自适配器）
   * @param {Object} options - 构建选项
   * @param {string} options.adapter - 适配器名称
   * @param {string} options.bot_id - 机器人ID
   * @param {string} options.event_type - 事件类型 (message|notice|request|device)
   * @returns {Object} 标准化的事件对象
   */
  static buildEvent(rawEvent, options = {}) {
    const {
      adapter = 'unknown',
      bot_id = rawEvent.self_id || rawEvent.bot_id || 'unknown',
      event_type = rawEvent.post_type || 'message'
    } = options

    // 基础事件对象
    const event = {
      // 事件标识
      post_type: event_type,
      event_type: event_type,
      adapter: adapter,
      bot_id: bot_id,
      self_id: rawEvent.self_id || rawEvent.bot_id || bot_id,
      time: rawEvent.time || Math.floor(Date.now() / 1000),
      timestamp: rawEvent.timestamp || Date.now(),
      
      // 用户信息（通用）
      user_id: this.normalizeId(rawEvent.user_id || rawEvent.userId || rawEvent.sender?.user_id),
      user_name: rawEvent.sender?.nickname || rawEvent.user_name || rawEvent.nickname || '',
      user_avatar: rawEvent.sender?.avatar || rawEvent.user_avatar || '',
      
      // 群组信息（如果是群组消息）
      group_id: this.normalizeId(rawEvent.group_id || rawEvent.groupId),
      group_name: rawEvent.group_name || rawEvent.groupName || '',
      
      // 消息信息
      message: rawEvent.message || rawEvent.content || '',
      raw_message: rawEvent.raw_message || rawEvent.rawMessage || '',
      message_id: rawEvent.message_id || rawEvent.messageId || rawEvent.msg_id || '',
      message_type: rawEvent.message_type || rawEvent.messageType || (rawEvent.group_id ? 'group' : 'private'),
      
      // 设备信息（如果适用）
      device_id: rawEvent.device_id || rawEvent.deviceId || '',
      device_type: rawEvent.device_type || rawEvent.deviceType || '',
      
      // 权限信息（将在loader中设置）
      isMaster: false,
      
      // 原始事件数据（保留以便适配器需要时访问）
      _raw: rawEvent,
      _adapter: adapter
    }

    // 处理@信息
    if (rawEvent.at) {
      event.at = Array.isArray(rawEvent.at) ? rawEvent.at : [rawEvent.at]
      event.at = event.at.map(id => this.normalizeId(id))
    }

    // 处理消息数组格式
    if (Array.isArray(rawEvent.message)) {
      event.message = rawEvent.message
      // 提取文本消息
      event.raw_message = rawEvent.message
        .filter(m => m.type === 'text')
        .map(m => m.text || m.data?.text || '')
        .join('')
    }

    // 处理通知类型事件
    if (event_type === 'notice') {
      event.notice_type = rawEvent.notice_type || rawEvent.noticeType || ''
      event.sub_type = rawEvent.sub_type || rawEvent.subType || ''
    }

    // 处理请求类型事件
    if (event_type === 'request') {
      event.request_type = rawEvent.request_type || rawEvent.requestType || ''
      event.sub_type = rawEvent.sub_type || rawEvent.subType || ''
      event.comment = rawEvent.comment || ''
      event.flag = rawEvent.flag || ''
    }

    // 处理设备类型事件
    if (event_type === 'device') {
      event.device_event_type = rawEvent.device_event_type || rawEvent.deviceEventType || ''
      event.device_data = rawEvent.device_data || rawEvent.deviceData || {}
    }

    return event
  }

  /**
   * 规范化ID（统一转换为字符串，但保留数字兼容性）
   * @param {string|number} id - 原始ID
   * @returns {string} 规范化后的ID
   */
  static normalizeId(id) {
    if (id === null || id === undefined) return ''
    if (typeof id === 'number') return String(id)
    if (typeof id === 'string') return id
    return String(id)
  }

  /**
   * 构建消息事件对象
   * @param {Object} rawEvent - 原始事件对象
   * @param {Object} options - 构建选项
   * @returns {Object} 标准化的消息事件对象
   */
  static buildMessageEvent(rawEvent, options = {}) {
    const event = this.buildEvent(rawEvent, { ...options, event_type: 'message' })
    
    // 初始化消息相关属性
    event.img = []
    event.video = []
    event.audio = []
    event.file = []
    event.msg = ''
    event.atList = []
    event.atBot = false
    
    // 处理消息内容
    if (Array.isArray(event.message)) {
      for (const item of event.message) {
        if (item.type === 'text') {
          event.msg += item.text || item.data?.text || ''
        } else if (item.type === 'image') {
          event.img.push(item.data?.file || item.url || '')
        } else if (item.type === 'video') {
          event.video.push(item.data?.file || item.url || '')
        } else if (item.type === 'audio' || item.type === 'record') {
          event.audio.push(item.data?.file || item.url || '')
        } else if (item.type === 'file') {
          event.file.push(item.data?.file || item.url || '')
        } else if (item.type === 'at') {
          const atId = this.normalizeId(item.data?.qq || item.data?.user_id)
          event.atList.push(atId)
          // 检查是否@了机器人
          if (atId === event.self_id || atId === event.bot_id) {
            event.atBot = true
          }
        }
      }
    } else if (typeof event.message === 'string') {
      event.msg = event.message
    }
    
    return event
  }

  /**
   * 构建通知事件对象
   * @param {Object} rawEvent - 原始事件对象
   * @param {Object} options - 构建选项
   * @returns {Object} 标准化的通知事件对象
   */
  static buildNoticeEvent(rawEvent, options = {}) {
    return this.buildEvent(rawEvent, { ...options, event_type: 'notice' })
  }

  /**
   * 构建请求事件对象
   * @param {Object} rawEvent - 原始事件对象
   * @param {Object} options - 构建选项
   * @returns {Object} 标准化的请求事件对象
   */
  static buildRequestEvent(rawEvent, options = {}) {
    return this.buildEvent(rawEvent, { ...options, event_type: 'request' })
  }

  /**
   * 构建设备事件对象
   * @param {Object} rawEvent - 原始事件对象
   * @param {Object} options - 构建选项
   * @returns {Object} 标准化的设备事件对象
   */
  static buildDeviceEvent(rawEvent, options = {}) {
    return this.buildEvent(rawEvent, { ...options, event_type: 'device' })
  }
}

