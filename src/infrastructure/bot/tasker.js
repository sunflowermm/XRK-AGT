import { EventNormalizer } from '#utils/event-normalizer.js'

/**
 * Tasker 基类
 * 提供标准化的 Bot 实例创建和事件处理
 */
export class TaskerBase {
  /**
   * 创建标准化的Bot实例
   * @param {Object} options - 配置选项
   * @param {string} options.id - Bot ID
   * @param {string} options.name - Bot名称
   * @param {string} options.type - tasker 类型 (onebot/device/stdin)
   * @param {Object} options.info - Bot信息
   * @param {Object} options.tasker - tasker 实例
   * @param {Object} bot - Bot主实例
   * @returns {Object} 标准化的Bot实例
   */
  static createBotInstance(options, bot) {
    const { id, name, type, info = {}, tasker } = options
    
    if (!id || !bot) {
      throw new Error('TaskerBase.createBotInstance: 缺少必要参数')
    }
    
    // 确保uin列表包含此Bot
    if (!bot.uin.includes(id)) {
      bot.uin.push(id)
    }
    
    // 创建标准化的Bot实例
    const botInstance = {
      // 基础属性
      uin: id,
      self_id: id,
      nickname: name,
      avatar: info.avatar || null,
      info: { ...info, user_id: id },
      
      // tasker 信息
      tasker: tasker || null,
      tasker_type: type,
      
      // 状态信息
      stat: {
        start_time: Math.floor(Date.now() / 1000),
        ...(info.stat || {})
      },
      
      // 版本信息
      version: info.version || {
        id: type,
        name: name,
        version: '1.0.0'
      },
      
      // 通用方法（所有 tasker 都支持）
      sendMsg: null, // 由 tasker 实现
      reply: null,   // 由 tasker 实现
      
      // 可选方法（tasker 可选择性实现）
      recallMsg: null,
      getMsg: null,
      
      // 标记
      _ready: false,
      _initializing: false
    }
    
    // 保存到Bot实例
    bot[id] = botInstance
    
    return botInstance
  }
  
  /**
   * 创建标准化的事件对象
   * 使用 EventNormalizer 统一标准化逻辑
   * 
   * @param {Object} options - 事件选项
   * @param {string} options.post_type - 事件类型 (message/notice/request)
   * @param {string} options.tasker_type - tasker 类型
   * @param {string} options.self_id - Bot ID
   * @param {Object} options.data - 事件数据
   * @param {Object} bot - Bot实例
   * @returns {Object} 标准化的事件对象
   */
  static createEvent(options, bot) {
    const { post_type, tasker_type, self_id, data = {} } = options
    
    if (!bot) {
      throw new Error('TaskerBase.createEvent: bot 参数必需')
    }
    
    // 获取Bot实例
    const botInstance = bot[self_id] || bot
    
    // 创建基础事件对象
    const event = {
      // 基础属性
      post_type: post_type || 'message',
      self_id: self_id || botInstance.self_id,
      time: Math.floor(Date.now() / 1000),
      
      // tasker 信息
      tasker: tasker_type || '',
      
      // Bot实例
      bot: botInstance,
      
      // 消息相关
      message: data.message || [],
      raw_message: data.raw_message || '',
      msg: '',
      
      // 用户相关
      user_id: data.user_id || null,
      sender: data.sender || {},
      
      // 群组相关
      group_id: data.group_id || null,
      
      // 设备相关
      device_id: data.device_id || null,
      device_name: data.device_name || null,
      event_type: data.event_type || post_type,
      
      // 原始数据
      ...data
    }
    
    // 使用 EventNormalizer 统一标准化
    EventNormalizer.normalize(event, {
      defaultPostType: post_type,
      defaultMessageType: data.message_type,
      defaultSubType: data.sub_type,
      defaultUserId: data.user_id
    })
    
    // 确保 event_id 存在
    if (!event.event_id) {
      const randomId = Math.random().toString(36).substr(2, 9)
      event.event_id = `${tasker_type || 'event'}_${event.post_type}_${Date.now()}_${randomId}`
    }
    
    return event
  }
  
  /**
   * 触发标准化事件
   * @param {string} adapter_type - 适配器类型
   * @param {Object} event - 事件对象
   * @param {Object} bot - Bot主实例
   */
  static emitEvent(adapter_type, event, bot) {
    if (!event || !bot) return
    
    const { post_type, event_type } = event
    
    // 构建事件名称
    const eventName = `${adapter_type}.${post_type}${event_type && event_type !== post_type ? `.${event_type}` : ''}`
    
    // 触发事件（从具体到通用）
    bot.em(eventName, event)
    
    // 如果event_type是message/notice/request，也触发通用事件
    if (['message', 'notice', 'request'].includes(event_type) && event_type !== post_type) {
      bot.em(`${adapter_type}.${event_type}`, event)
    }
  }
}
