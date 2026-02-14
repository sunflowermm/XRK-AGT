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

    e.post_type = e.post_type || options.defaultPostType || 'message'
    e.message_type = e.message_type || options.defaultMessageType || (e.group_id ? 'group' : 'private')
    e.time = e.time || Math.floor(Date.now() / 1000)
    if (!e.sub_type && options.defaultSubType) e.sub_type = options.defaultSubType

    // 标准化 sender（仅在未设置时）
    if (!e.sender) e.sender = {}
    if (!e.sender.user_id) e.sender.user_id = e.user_id || options.defaultUserId || 'unknown'
    if (!e.user_id) e.user_id = e.sender.user_id
    if (!e.sender.nickname) e.sender.nickname = e.sender.card || e.sender.user_id || 'unknown'
    if (!e.sender.card) e.sender.card = e.sender.nickname

    return e
  }

  /**
   * 标准化消息字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeMessage(e) {
    if (!e) return e

    // 标准化message数组
    if (!Array.isArray(e.message)) {
      e.message = e.message ? [{ type: 'text', text: String(e.message) }] : []
    }

    // 从message生成raw_message
    if (!e.raw_message && e.message.length > 0) {
      e.raw_message = e.message
        .map(seg => seg.type === 'text' ? (seg.text || '') : `[${seg.type}]`)
        .join('')
    }

    // 处理command字段（仅设置raw_message，msg由parseMessage重新构建）
    if (e.command && !e.raw_message) {
      e.raw_message = e.command
    }

    // 确保raw_message存在（msg由parseMessage从message数组构建）
    if (!e.raw_message) {
      e.raw_message = e.text || ''
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
    // 与 QQ 私聊一致：设备会话视为“非群聊”，便于统一走 getChatHistory / 历史 key
    e.isGroup = false
    e.isPrivate = true

    return e
  }

  /**
   * 标准化Stdin事件特有字段
   * @param {Object} e - 事件对象
   * @returns {Object} 标准化后的事件对象
   */
  static normalizeStdin(e) {
    if (!e) return e

    e.tasker = e.tasker || 'stdin'
    e.isStdin = true

    return e
  }
}

