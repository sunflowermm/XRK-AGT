import StreamLoader from '#infrastructure/aistream/loader.js';

const SymbolTimeout = Symbol('Timeout')
const SymbolResolve = Symbol('Resolve')

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

const normalizeRuleShape = (rule) => {
  if (!rule) return null
  if (typeof rule === 'string' || rule instanceof RegExp) {
    return { reg: rule }
  }
  if (typeof rule === 'object' && !Array.isArray(rule)) {
    return {
      ...rule,
      reg: rule.reg ?? rule.pattern ?? rule.source ?? rule.match
    }
  }
  return null
}

const normalizeRules = (rules) => ensureArray(rules)
  .map(normalizeRuleShape)
  .filter(Boolean)

const normalizeTaskShape = (task) => {
  if (!task || typeof task !== 'object') return null
  if (!task.cron || !task.fnc) return null
  return {
    name: task.name || '',
    cron: String(task.cron).trim(),
    fnc: task.fnc,
    log: task.log !== false,
    timezone: task.timezone,
    immediate: task.immediate === true
  }
}

const normalizeTasks = (tasks) => ensureArray(tasks)
  .map(normalizeTaskShape)
  .filter(Boolean)

const normalizeHandlers = (handlers) => {
  if (!handlers) return []
  const list = Array.isArray(handlers)
    ? handlers
    : Object.values(handlers)

  return list
    .map(handler => {
      if (!handler) return null
      if (typeof handler === 'string') {
        return { key: handler, fnc: handler }
      }
      if (typeof handler === 'function') {
        return { key: handler.name || 'handler', fnc: handler.name, ref: handler }
      }
      if (typeof handler === 'object') {
        const fnc = handler.fnc || handler.fn
        const key = handler.key || handler.event || fnc
        if (!fnc || !key) return null
        return {
          key,
          fnc,
          priority: handler.priority,
          once: handler.once === true
        }
      }
      return null
    })
    .filter(Boolean)
}

const normalizeEventSubscribe = (subs) => {
  if (!subs) return []
  if (Array.isArray(subs)) {
    return subs.map(item => {
      if (!item) return null
      if (typeof item === 'function') return null
      const eventType = item.eventType || item.event || item.type
      if (!eventType) return null
      if (typeof item.handler === 'function') {
        return { eventType, handler: item.handler }
      }
      if (typeof item.handler === 'string' || typeof item.fnc === 'string') {
        return { eventType, fnc: item.handler || item.fnc }
      }
      return null
    }).filter(Boolean)
  }

  return Object.entries(subs)
    .map(([eventType, handler]) => {
      if (!eventType) return null
      if (typeof handler === 'function') {
        return { eventType, handler }
      }
      if (typeof handler === 'string') {
        return { eventType, fnc: handler }
      }
      return null
    })
    .filter(Boolean)
}

const contextStore = new Map()

const getContextBucket = (key, create = false) => {
  if (!key) return null
  if (!contextStore.has(key) && create) {
    contextStore.set(key, new Map())
  }
  return contextStore.get(key) || null
}

const cleanupBucket = (key) => {
  const bucket = contextStore.get(key)
  if (bucket && bucket.size === 0) {
    contextStore.delete(key)
  }
}

  /**
   * 插件基类
   * 
   * 所有插件的基类，提供事件处理、工作流集成、上下文管理等功能。
   * 插件通过继承此类实现消息处理、定时任务、事件监听等功能。
   * 
   * 标准化事件系统:
   * - 监听 "message" 可以匹配所有适配器的 message 事件（跨平台）
   * - 监听 "onebot.message" 只匹配 OneBot 适配器的 message 事件
   * - 监听 "onebot.notice" 只匹配 OneBot 适配器的 notice 事件
   * - 监听 "onebot.request" 只匹配 OneBot 适配器的 request 事件
   * - 监听 "onebot.*" 可以匹配所有 OneBot 事件
   * - 监听 "device.message" 只匹配设备的 message 事件
   * - 监听 "device.notice" 只匹配设备的 notice 事件
   * - 监听 "device.request" 只匹配设备的 request 事件
   * - 监听 "device.*" 可以匹配所有设备事件
   * - 监听 "device" 可以匹配所有设备事件
   * - 监听 "stdin.command" 只匹配标准输入的命令事件
   * - 监听 "stdin.*" 可以匹配所有标准输入事件
   * 
   * @abstract
   * @class plugin
   * @example
  * // 跨平台插件：监听所有 tasker 的消息
   * export default class CrossPlatformPlugin extends plugin {
   *   constructor() {
   *     super({
   *       name: 'cross-platform-plugin',
   *       dsc: '跨平台插件',
  *       event: 'message',  // 匹配所有 tasker 的 message 事件
   *       priority: 5000,
   *       rule: [
   *         {
   *           reg: '^#测试$',
   *           fnc: 'test'
   *         }
   *       ]
   *     });
   *   }
   *   
   *   async test(e) {
  *     await this.reply(`收到来自 ${e.tasker} 的消息: ${e.msg}`);
   *   }
   * }
   * 
   * @example
   * // 只监听 OneBot 的消息
   * export default class OneBotPlugin extends plugin {
   *   constructor() {
   *     super({
   *       name: 'onebot-plugin',
  *       dsc: 'OneBot 插件',
   *       event: 'onebot.message',  // 只匹配 OneBot 的 message 事件
   *       priority: 5000,
   *       rule: [
   *         {
   *           reg: '^#测试$',
   *           fnc: 'test'
   *         }
   *       ]
   *     });
   *   }
   *   
   *   async test(e) {
   *     await this.reply('测试成功');
   *   }
   * }
   * 
   * @example
   * // 只监听设备的消息
   * export default class DevicePlugin extends plugin {
   *   constructor() {
   *     super({
   *       name: 'device-plugin',
   *       dsc: '设备插件',
   *       event: 'device.message',  // 只匹配设备的 message 事件
   *       rule: [{ reg: '.*', fnc: 'handle' }]
   *     });
   *   }
   * }
   * 
   * @example
   * // 监听所有 OneBot 事件
   * export default class AllOneBotPlugin extends plugin {
   *   constructor() {
   *     super({
   *       name: 'all-onebot-plugin',
   *       event: 'onebot.*',  // 匹配所有 OneBot 事件
   *       rule: [{ reg: '.*', fnc: 'handle' }]
   *     });
   *   }
   * }
   */
export default class plugin {
  constructor(options = {}) {
    this.name = options.name || "your-plugin"
    this.dsc = options.dsc || "无"
    this.event = options.event || "message"
    this.priority = options.priority || 5000
    const normalizedTasks = normalizeTasks(options.task)
    const normalizedHandlers = normalizeHandlers(options.handler)
    const normalizedEvents = normalizeEventSubscribe(options.eventSubscribe)
    const normalizedRules = normalizeRules(options.rule)

    this.task = normalizedTasks.length ? normalizedTasks : null
    this.rule = normalizedRules || []
    this.bypassThrottle = options.bypassThrottle || false
    this.handler = normalizedHandlers.length ? normalizedHandlers : null
    this.eventSubscribe = normalizedEvents.length ? normalizedEvents : null
    
    if (options.handler) {
      this.namespace = options.namespace || ""
    }
  }

  /**
   * 获取工作流
   */
  getStream(name) {
    return StreamLoader.getStream(name);
  }

  /**
   * 获取所有工作流
   */
  getAllStreams() {
    return StreamLoader.getAllStreams();
  }

  /**
   * 回复消息（通用方法，支持所有 tasker）
   */
  reply(msg = "", quote = false, data = {}) {
    if (!this.e) return false
    if (!msg) return false
    
    // 优先使用事件对象的reply方法
    if (this.e.reply && typeof this.e.reply === 'function') {
      return this.e.reply(msg, quote, data)
    }
    
    // 如果没有reply方法，尝试使用bot的sendMsg
    if (this.e.bot && this.e.bot.sendMsg) {
      return this.e.bot.sendMsg(msg, quote, data)
    }
    
    // 最后尝试使用 tasker 的 sendMsg
    if (this.e.tasker && this.e.bot?.tasker?.sendMsg) {
      return this.e.bot.tasker.sendMsg(this.e, msg)
    }
    
    return false
  }

  /**
   * 标记需要重新解析
   */
  markNeedReparse() {
    if (this.e) {
      this.e._needReparse = true
    }
  }

  /**
   * 获取上下文键
   */
  conKey(isGroup = false) {
    const selfId = this.e?.self_id || ''
    const targetId = isGroup ? 
      (this.group_id || this.e?.group_id || '') : 
      (this.user_id || this.e?.user_id || '')
    return `${this.name}.${selfId}.${targetId}`
  }

  /**
   * 设置上下文
   */
  setContext(type, isGroup = false, time = 120, timeout = "操作超时已取消") {
    if (!type || !this.e) return null

    const key = this.conKey(isGroup)
    this.finish(type, isGroup)

    const bucket = getContextBucket(key, true)
    bucket.set(type, this.e)

    if (time > 0) {
      this.e[SymbolTimeout] = setTimeout(() => {
        const stored = bucket.get(type)
        if (!stored) return

        const resolve = stored[SymbolResolve]
        bucket.delete(type)
        cleanupBucket(key)

        resolve ? resolve(false) : this.reply(timeout, true)
      }, time * 1000)
    }
    
    return this.e
  }

  /**
   * 获取上下文
   */
  getContext(type, isGroup = false) {
    const key = this.conKey(isGroup)
    const bucket = getContextBucket(key)
    if (!bucket) return null

    if (!type) {
      return Object.fromEntries(bucket.entries())
    }

    return bucket.get(type) || null
  }

  /**
   * 结束上下文
   */
  finish(type, isGroup = false) {
    if (!type) return

    const key = this.conKey(isGroup)
    const bucket = getContextBucket(key)
    if (!bucket) return

    const context = bucket.get(type)
    
    if (context) {
      const timeout = context[SymbolTimeout]
      const resolve = context[SymbolResolve]
      
      if (timeout) clearTimeout(timeout)
      if (resolve) resolve(true)
      
      bucket.delete(type)
      cleanupBucket(key)
    }
  }

  /**
   * 等待上下文
   */
  awaitContext(...args) {
    return new Promise(resolve => {
      const context = this.setContext("resolveContext", ...args)
      if (context) context[SymbolResolve] = resolve
    })
  }

  /**
   * 解析上下文
   */
  resolveContext(context) {
    const key = this.conKey(false)
    const bucket = getContextBucket(key)
    const storedContext = bucket?.get("resolveContext")
    const resolve = storedContext?.[SymbolResolve]
    
    this.finish("resolveContext")
    if (resolve && context) resolve(this.e)
  }

  /**
   * 前置检查方法（accept）
   * 插件可以通过重写此方法来实现自定义的前置检查逻辑
   * 例如：黑白名单、权限检查、事件过滤等
   * 
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean|string>}
   *   - true: 通过检查，继续处理
   *   - false: 拒绝处理，跳过当前插件
   *   - 'return': 停止处理，不再执行后续插件
   *   - 其他值: 继续处理，但可以用于传递状态
   * 
   * @example
   * // 在插件中重写accept方法实现黑白名单
   * async accept(e) {
   *   // 特殊事件直接通过
   *   if (e.isDevice || e.isStdin) return true
   *   
   *   // 检查黑名单
   *   if (this.isBlacklisted(e.user_id)) {
   *     return false
   *   }
   *   
   *   // 检查白名单
   *   if (this.hasWhitelist() && !this.isWhitelisted(e.user_id)) {
   *     return false
   *   }
   *   
   *   return true
   * }
   */
  async accept(e) {
    // 默认实现：所有事件都通过
    return true
  }

  /**
   * 导出插件描述（用于加载器标准化）
   */
  getDescriptor() {
    return {
      name: this.name,
      dsc: this.dsc,
      event: this.event,
      priority: this.priority,
      bypassThrottle: this.bypassThrottle === true,
      namespace: this.namespace || '',
      rule: normalizeRules(this.rule),
      tasks: normalizeTasks(this.task),
      handlers: normalizeHandlers(this.handler),
      eventSubscribe: normalizeEventSubscribe(this.eventSubscribe)
    }
  }
}

export const PluginSchema = {
  normalizeRules,
  normalizeTasks,
  normalizeHandlers,
  normalizeEventSubscribe
}
