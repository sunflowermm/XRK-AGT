import plugin from './plugin.js'

/**
 * Enhancer基类
 * 提供通用的增强逻辑，减少重复代码
 */
export default class EnhancerBase extends plugin {
  constructor(config) {
    super({
      ...config,
      priority: config.priority || 1,
      rule: config.rule || []
    })
    this.tasker = config.tasker || ''
  }

  /**
   * 检查是否是目标事件类型
   * @param {Object} e - 事件对象
   * @param {string} taskerName - 适配器名称
   * @returns {boolean} 是否是目标事件
   */
  isTargetEvent(e, taskerName) {
    if (!this.tasker) return false
    return taskerName === this.tasker || e[`is${this.tasker.charAt(0).toUpperCase() + this.tasker.slice(1)}`] === true
  }

  /**
   * 增强事件属性
   * @param {Object} e - 事件对象
   */
  enhanceEvent(e) {
    if (!this.tasker) return
    
    // 设置任务类型标识
    e[`is${this.tasker.charAt(0).toUpperCase() + this.tasker.slice(1)}`] = true
    e.tasker = this.tasker
    
    // 确保日志文本
    this.ensureLogText(e, this.name || 'Enhancer', this.getEventScope(e), this.getEventType(e))
  }

  /**
   * 获取事件范围（如群ID、用户ID等）
   * @param {Object} e - 事件对象
   * @returns {string} 事件范围
   */
  getEventScope(e) {
    return e.group_id ? `group:${e.group_id}` : (e.user_id || 'unknown')
  }

  /**
   * 获取事件类型
   * @param {Object} e - 事件对象
   * @returns {string} 事件类型
   */
  getEventType(e) {
    return e.event_type || e.post_type || 'event'
  }

  /**
   * 设置回复方法
   * @param {Object} e - 事件对象
   */
  setupReply(e) {
    // 子类实现
  }

  /**
   * 应用配置策略
   * @param {Object} e - 事件对象
   * @returns {string|boolean} 返回 'return' 表示跳过，false 表示拒绝，true 表示继续
   */
  applyConfigPolicies(e) {
    // 子类实现
    return true
  }

  /**
   * 应用别名
   * @param {Object} e - 事件对象
   */
  applyAlias(e) {
    // 子类实现
  }

  /**
   * 强制执行回复策略
   * @param {Object} e - 事件对象
   * @returns {string|boolean} 返回 'return' 表示跳过
   */
  enforceReplyPolicy(e) {
    // 子类实现
    return true
  }

  /**
   * 通用accept方法
   * @param {Object} e - 事件对象
   * @returns {string|boolean} 返回 'return' 表示跳过，false 表示拒绝，true 表示继续
   */
  async accept(e) {
    const taskerName = this.getAdapterName(e)
    if (!this.isTargetEvent(e, taskerName)) return true

    this.enhanceEvent(e)
    
    const cfgResult = this.applyConfigPolicies(e)
    if (cfgResult === 'return' || cfgResult === false) return cfgResult

    this.setupReply(e)
    this.applyAlias(e)
    
    return this.enforceReplyPolicy(e) === 'return' ? 'return' : true
  }

  /**
   * 获取适配器名称
   * @param {Object} e - 事件对象
   * @returns {string} 适配器名称
   */
  getAdapterName(e) {
    return String(e.tasker || e.tasker_name || '').toLowerCase()
  }

  /**
   * 确保日志文本
   * @param {Object} e - 事件对象
   * @param {string} prefix - 前缀
   * @param {string} scope - 事件范围
   * @param {string} eventType - 事件类型
   */
  ensureLogText(e, prefix, scope, eventType) {
    if (e.logText && !e.logText.includes('未知')) return
    e.logText = `[${prefix}][${scope}][${eventType}]`
  }

  /**
   * 安全定义属性
   * @param {Object} obj - 目标对象
   * @param {string} key - 属性名
   * @param {Function} getter - 属性getter
   */
  safeDefine(obj, key, getter) {
    if (obj[key] !== undefined) return
    try {
      Object.defineProperty(obj, key, {
        get: getter,
        configurable: true,
        enumerable: false
      })
    } catch (error) {
      // 静默失败
    }
  }

  /**
   * 处理@属性
   * @param {Object} e - 事件对象
   */
  processAtProperties(e) {
    // 子类实现
  }

  /**
   * 绑定机器人实体（如friend、group等）
   * @param {Object} e - 事件对象
   */
  bindBotEntities(e) {
    if (!e.bot) return

    if (e.user_id && e.bot.pickFriend) {
      this.safeDefine(e, 'friend', () => e.bot.pickFriend(e.user_id))
    }

    if (e.group_id && e.bot.pickGroup) {
      this.safeDefine(e, 'group', () => e.bot.pickGroup(e.group_id))
    }

    if (e.group_id && e.user_id && e.bot.pickMember) {
      this.safeDefine(e, 'member', () => e.bot.pickMember(e.group_id, e.user_id))
    }
  }
}
