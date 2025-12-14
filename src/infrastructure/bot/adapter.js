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
    
    // 根据类型添加特定方法
    if (type === 'onebot') {
      // OneBot特定方法在onebot.js中注册
    } else if (type === 'device') {
      // Device特定方法
      botInstance.device_type = info.device_type
      botInstance.capabilities = info.capabilities || []
      botInstance.online = info.online !== false
    } else if (type === 'stdin') {
      // Stdin特定方法
      botInstance.config = { master: true }
    }
    
    // 保存到Bot实例
    bot[id] = botInstance
    
    return botInstance
  }
  
  /**
   * 创建标准化的事件对象
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
    
    // 创建标准化事件对象
    const event = {
      // 基础属性
      post_type,
      self_id,
      time: Math.floor(Date.now() / 1000),
      event_id: `${post_type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      
      // 适配器信息
      adapter: adapter_type,
      isOneBot: adapter_type === 'onebot',
      isDevice: adapter_type === 'device',
      isStdin: adapter_type === 'stdin',
      
      // Bot实例
      bot: botInstance,
      
      // 消息相关（如果是消息事件）
      message: data.message || [],
      raw_message: data.raw_message || '',
      msg: '',
      
      // 用户相关
      user_id: data.user_id || self_id,
      sender: data.sender || {},
      
      // 群组相关（如果是群组消息）
      group_id: data.group_id || null,
      isGroup: !!data.group_id,
      isPrivate: !data.group_id,
      
      // 设备相关（如果是设备事件）
      device_id: data.device_id || self_id,
      device_name: data.device_name || null,
      event_type: data.event_type || post_type,
      
      // 回复方法（由插件加载器设置）
      reply: null,
      
      // 原始数据
      ...data
    }
    
    // 设置回复方法
    if (botInstance && botInstance.sendMsg) {
      event.reply = async (msg = '', quote = false, data = {}) => {
        if (!msg) return false
        try {
          return await botInstance.sendMsg(msg, quote, data)
        } catch (error) {
          BotUtil.makeLog('error', `回复消息失败: ${error.message}`, self_id)
          return { error: error.message }
        }
      }
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
