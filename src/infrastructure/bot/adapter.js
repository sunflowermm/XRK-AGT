import BotUtil from '#utils/botutil.js'

/**
 * 适配器基类
 * 提供标准化的Bot实例创建和事件处理
 */
export class AdapterBase {
  /**
   * 创建标准化的Bot实例
   * @param {Object} options - 配置选项
   * @param {string} options.id - Bot ID
   * @param {string} options.name - Bot名称
   * @param {string} options.type - 适配器类型 (onebot/device/stdin)
   * @param {Object} options.info - Bot信息
   * @param {Object} options.adapter - 适配器实例
   * @param {Object} bot - Bot主实例
   * @returns {Object} 标准化的Bot实例
   */
  static createBotInstance(options, bot) {
    const { id, name, type, info = {}, adapter } = options
    
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
      
      // 适配器信息
      adapter: adapter || null,
      adapter_type: type,
      
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
      
      // 通用方法（所有适配器都支持）
      sendMsg: null, // 由适配器实现
      reply: null,   // 由适配器实现
      
      // 可选方法（适配器可选择性实现）
      recallMsg: null,
      getMsg: null,
      
      // 标记
      _ready: false,
      _initializing: false
    }
    
    // 适配器特定属性由适配器自己设置，这里不处理
    // OneBot特定方法在onebot.js中注册
    // Device和Stdin特定属性由对应适配器设置
    
    // 保存到Bot实例
    bot[id] = botInstance
    
    return botInstance
  }
  
  /**
   * 创建标准化的事件对象（仅包含所有适配器通用的基础属性）
   * 适配器特定的属性（如isGroup、isPrivate、friend、group等）由增强插件处理
   * 
   * @param {Object} options - 事件选项
   * @param {string} options.post_type - 事件类型 (message/notice/request)
   * @param {string} options.adapter_type - 适配器类型
   * @param {string} options.self_id - Bot ID
   * @param {Object} options.data - 事件数据
   * @param {Object} bot - Bot实例
   * @returns {Object} 标准化的事件对象
   */
  static createEvent(options, bot) {
    const { post_type, adapter_type, self_id, data = {} } = options
    
    // 获取Bot实例
    const botInstance = bot[self_id] || bot
    
    // 创建标准化事件对象（只包含通用属性）
    const event = {
      // 基础属性
      post_type: post_type || 'message',
      self_id,
      time: Math.floor(Date.now() / 1000),
      event_id: `${adapter_type || 'event'}_${post_type || 'message'}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      
      // 适配器信息（通用）
      adapter: adapter_type || '',
      
      // Bot实例
      bot: botInstance,
      
      // 消息相关（通用，所有适配器都可能有的）
      message: data.message || [],
      raw_message: data.raw_message || '',
      msg: '',
      
      // 用户相关（通用）
      user_id: data.user_id || null,
      sender: data.sender || {},
      
      // 群组相关（通用字段，不设置isGroup/isPrivate，由增强插件处理）
      group_id: data.group_id || null,
      
      // 设备相关（通用字段）
      device_id: data.device_id || null,
      device_name: data.device_name || null,
      event_type: data.event_type || post_type,
      
      // 回复方法（通用，由bot.js的prepareEvent设置）
      reply: null,
      
      // 原始数据
      ...data
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
