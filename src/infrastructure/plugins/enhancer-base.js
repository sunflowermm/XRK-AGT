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
  }

  /**
   * 检查是否是目标事件类型
   * @param {Object} e - 事件对象
   * @param {string} taskerName - 适配器名称
   * @returns {boolean} 是否是目标事件
   */
  isTargetEvent(e, taskerName) {
    // 子类实现
    return false
  }

  /**
   * 增强事件属性
   * @param {Object} e - 事件对象
   */
  enhanceEvent(e) {
    // 子类实现
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
    
    if (this.enforceReplyPolicy(e) === 'return') return 'return'

    return true
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
   * @param {string} deviceId - 设备ID
   * @param {string} eventType - 事件类型
   */
  ensureLogText(e, prefix, deviceId, eventType) {
    if (e.logText && !/未知/.test(e.logText)) return
    e.logText = `[${prefix}][${deviceId}][${eventType}]`
  }

  /**
   * 处理@属性
   * @param {Object} e - 事件对象
   */
  processAtProperties(e) {
    // 子类实现
  }
}

