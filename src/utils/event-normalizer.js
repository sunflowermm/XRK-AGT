/**
 * 统一事件标准化器
 * 提供通用的事件标准化逻辑，减少重复代码
 */
export class EventNormalizer {
  /**
   * 标准化事件基础字段
   * @param {Object} e - 事件对象
   * @param {Object} options - 标准化选项
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeBase(e, options = {}) {
    if (!e) return e

    // 确保 post_type
    e.post_type = e.post_type || options.defaultPostType || 'message'

    // 确保 message_type
    if (!e.message_type) {
      e.message_type = options.defaultMessageType || (e.group_id ? 'group' : 'private')
    }

    // 确保 sender 对象
    if (!e.sender) {
      e.sender = {}
    }
    e.sender.user_id = e.sender.user_id || e.user_id || options.defaultUserId || 'unknown'
    e.sender.nickname = e.sender.nickname || e.sender.user_id || 'unknown'
    e.sender.card = e.sender.card || e.sender.nickname

    // 确保时间戳
    e.time = e.time || Math.floor(Date.now() / 1000)

    // 确保 sub_type
    if (!e.sub_type && options.defaultSubType) {
      e.sub_type = options.defaultSubType
    }

    return e
  }

  /**
   * 标准化消息字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeMessage(e) {
    if (!e) return e

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
      e.raw_message = e.text || e.msg || e.command || ''
    }

    // 设置 msg 字段（插件系统需要）
    if (!e.msg) {
      e.msg = e.raw_message || e.text || e.command || ''
    }

    // 如果 command 存在但 raw_message 不存在，使用 command
    if (e.command && !e.raw_message) {
      e.raw_message = e.command
      e.msg = e.command
    }

    return e
  }

  /**
   * 标准化群组相关字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeGroup(e) {
    if (!e) return e

    if (e.group_id && !e.group_name) {
      e.group_name = e.group?.name || e.group?.group_name || ''
    }

    // 确保 message_type 基于 group_id
    if (e.group_id && e.message_type !== 'group') {
      e.message_type = 'group'
    }

    return e
  }

  /**
   * 完整标准化（组合所有方法）
   * @param {Object} e - 事件对象
   * @param {Object} options - 标准化选项
   * @returns {Object} 标准化后的事件对象
   */
  static normalize(e, options = {}) {
    if (!e) return e

    this.normalizeBase(e, options)
    this.normalizeMessage(e)
    this.normalizeGroup(e)

    return e
  }

  /**
   * 标准化OneBot事件特有字段
   * @param {Object} e - 事件对象
   * @param {string} eventType - 事件类型
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeOneBot(e, eventType) {
    if (!e) return e

    // 从事件类型推断 post_type
    if (!e.post_type && eventType) {
      const parts = eventType.split('.')
      if (parts.length >= 2) {
        e.post_type = parts[1]
      }
    }

    // 确保 isPrivate 和 isGroup
    e.isPrivate = e.message_type === 'private' || (!e.group_id && e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id

    return e
  }

  /**
   * 标准化Device事件特有字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeDevice(e) {
    if (!e) return e

    // 标准化消息类型
    if (e.post_type === 'device' && e.event_type === 'message') {
      e.post_type = 'message'
    }

    return e
  }

  /**
   * 标准化Stdin事件特有字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeStdin(e) {
    if (!e) return e

    // Stdin 特有逻辑已在 normalizeBase 中处理
    return e
  }
}

