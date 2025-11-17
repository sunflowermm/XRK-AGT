/**
 * 事件处理器管理系统
 * 用于管理和调度各种事件的处理函数
 */
class HandlerManager {
  constructor() {
    /** @type {Map<string, Array>} 事件处理器映射 */
    this.events = new Map()
    /** @type {Map<string, boolean>} 排序状态缓存 */
    this.sortedCache = new Map()
  }

  /**
   * 添加事件处理器
   * @param {Object} cfg - 配置对象
   * @param {string} cfg.ns - 命名空间
   * @param {Function} cfg.fn - 处理函数
   * @param {Object} cfg.self - 上下文对象
   * @param {number} [cfg.priority=500] - 优先级（数字越小优先级越高）
   * @param {string} [cfg.key] - 事件键名
   * @param {string} [cfg.event] - 事件名（key的别名）
   * @returns {boolean} 是否添加成功
   */
  add(cfg) {
    const { ns, fn, self, priority = 500 } = cfg
    const key = cfg.key || cfg.event || ''

    // 参数验证
    if (!this._validateParams(key, fn, ns)) {
      return false
    }

    // 删除同命名空间的旧处理器
    this.del(ns, key)

    logger.mark(`[Handler][Reg]: [${ns}][${key}]`)

    // 获取或创建事件处理器数组
    const handlers = this._getOrCreateHandlers(key)
    
    // 创建并插入处理器
    const handler = { priority, fn, ns, self, key }
    const insertIndex = this._findInsertIndex(handlers, priority)
    handlers.splice(insertIndex, 0, handler)

    // 标记已排序
    this.sortedCache.set(key, true)

    return true
  }

  /**
   * 删除事件处理器
   * @param {string} ns - 命名空间
   * @param {string} [key=''] - 事件键名（可选）
   * @returns {number} 删除的处理器数量
   */
  del(ns, key = '') {
    if (!ns) {
      logger.error('[Handler][Del]: 缺少命名空间参数')
      return 0
    }

    // 删除命名空间下所有处理器
    if (!key) {
      return this._deleteAllInNamespace(ns)
    }

    // 删除指定key的处理器
    return this._deleteHandler(ns, key)
  }

  /**
   * 调用事件处理器
   * @param {string} key - 事件键名
   * @param {Object} e - 事件对象
   * @param {*} args - 额外参数
   * @param {boolean} [allHandler=false] - 是否调用所有处理器
   * @returns {*} 处理器返回值
   */
  async call(key, e, args, allHandler = false) {
    const handlers = this.events.get(key)
    
    if (!handlers?.length) {
      logger.debug(`[Handler][Call]: 没有找到 [${key}] 的处理器`)
      return
    }

    // 遍历执行处理器
    for (const handler of handlers) {
      const result = await this._executeHandler(handler, e, args)
      
      if (result.done && !allHandler) {
        return result.value
      }
    }
  }

  /**
   * 调用所有处理器
   * @param {string} key - 事件键名
   * @param {Object} e - 事件对象
   * @param {*} args - 额外参数
   */
  async callAll(key, e, args) {
    // 功能暂时禁用
    // return this.call(key, e, args, true)
  }

  /**
   * 检查是否存在处理器
   * @param {string} key - 事件键名
   * @returns {boolean}
   */
  has(key) {
    return this.events.has(key) && this.events.get(key).length > 0
  }

  /**
   * 获取处理器数量
   * @param {string} key - 事件键名
   * @returns {number}
   */
  count(key) {
    return this.events.get(key)?.length || 0
  }

  /**
   * 获取所有事件键名
   * @returns {string[]}
   */
  getKeys() {
    return Array.from(this.events.keys())
  }

  /**
   * 清空所有处理器
   */
  clear() {
    this.events.clear()
    this.sortedCache.clear()
    logger.mark('[Handler][Clear]: 已清空所有处理器')
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const stats = {
      totalEvents: this.events.size,
      totalHandlers: 0,
      eventDetails: {}
    }

    for (const [key, handlers] of this.events) {
      stats.totalHandlers += handlers.length
      stats.eventDetails[key] = {
        count: handlers.length,
        handlers: handlers.map(h => ({
          ns: h.ns,
          priority: h.priority
        }))
      }
    }

    return stats
  }

  // ========== 私有方法 ==========

  /**
   * 验证参数
   * @private
   */
  _validateParams(key, fn, ns) {
    if (!key || typeof key !== 'string') {
      logger.error('[Handler][Add]: 事件键名无效')
      return false
    }

    if (typeof fn !== 'function') {
      logger.error(`[Handler][Add]: [${ns}][${key}] 处理函数必须是函数类型`)
      return false
    }

    if (!ns) {
      logger.error(`[Handler][Add]: [${key}] 缺少命名空间`)
      return false
    }

    return true
  }

  /**
   * 获取或创建处理器数组
   * @private
   */
  _getOrCreateHandlers(key) {
    if (!this.events.has(key)) {
      this.events.set(key, [])
    }
    return this.events.get(key)
  }

  /**
   * 删除命名空间下所有处理器
   * @private
   */
  _deleteAllInNamespace(ns) {
    let deletedCount = 0
    for (const [eventKey] of this.events) {
      deletedCount += this.del(ns, eventKey)
    }
    return deletedCount
  }

  /**
   * 删除指定处理器
   * @private
   */
  _deleteHandler(ns, key) {
    const handlers = this.events.get(key)
    if (!handlers?.length) return 0

    const originalLength = handlers.length
    const filteredHandlers = handlers.filter(h => h.ns !== ns)
    const deletedCount = originalLength - filteredHandlers.length
    
    if (deletedCount > 0) {
      if (filteredHandlers.length === 0) {
        this.events.delete(key)
        this.sortedCache.delete(key)
      } else {
        this.events.set(key, filteredHandlers)
      }
      
      logger.debug(`[Handler][Del]: 删除了 [${ns}][${key}] 的 ${deletedCount} 个处理器`)
    }

    return deletedCount
  }

  /**
   * 执行单个处理器
   * @private
   */
  async _executeHandler(handler, e, args) {
    const { fn, self, ns, key } = handler
    let done = true
    
    // reject函数用于标记处理失败
    const reject = (msg = '') => {
      if (msg) {
        logger.mark(`[Handler][Reject]: [${ns}][${key}] ${msg}`)
      }
      done = false
    }

    try {
      const value = await fn.call(self, e, args, reject)
      
      if (done) {
        logger.mark(`[Handler][Done]: [${ns}][${key}]`)
      }
      
      return { done, value }
    } catch (error) {
      logger.error(`[Handler][Error]: [${ns}][${key}] 执行出错:`)
      logger.error(error.stack || error)
      return { done: false, value: undefined }
    }
  }

  /**
   * 二分查找插入位置
   * @private
   * @param {Array} handlers - 处理器数组
   * @param {number} priority - 优先级
   * @returns {number} 插入位置索引
   */
  _findInsertIndex(handlers, priority) {
    let left = 0
    let right = handlers.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (handlers[mid].priority <= priority) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }
}

// 创建单例实例
const handlerInstance = new HandlerManager()

// 导出静态接口
const Handler = {
  add: handlerInstance.add.bind(handlerInstance),
  del: handlerInstance.del.bind(handlerInstance),
  call: handlerInstance.call.bind(handlerInstance),
  callAll: handlerInstance.callAll.bind(handlerInstance),
  has: handlerInstance.has.bind(handlerInstance),
  count: handlerInstance.count.bind(handlerInstance),
  getKeys: handlerInstance.getKeys.bind(handlerInstance),
  clear: handlerInstance.clear.bind(handlerInstance),
  getStats: handlerInstance.getStats.bind(handlerInstance)
}

export default Handler