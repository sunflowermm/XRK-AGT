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
    return { ...rule }
  }
  return null
}

const normalizeRules = (rules) => ensureArray(rules)
  .map(normalizeRuleShape)
  .filter(Boolean)

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
 * @abstract
 * @class plugin
 * @example
 * // 创建自定义插件
 * export default class MyPlugin extends plugin {
 *   constructor() {
 *     super({
 *       name: 'my-plugin',
 *       dsc: '我的插件',
 *       event: 'message',
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
 */
export default class plugin {
  constructor(options = {}) {
    this.name = options.name || "your-plugin"
    this.dsc = options.dsc || "无"
    this.event = options.event || "message"
    this.priority = options.priority || 5000
    this.task = options.task ?? null
    this.rule = normalizeRules(options.rule)
    this.bypassThrottle = options.bypassThrottle || false
    
    if (options.handler) {
      this.handler = { ...options.handler }
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
   * 回复消息
   */
  reply(msg = "", quote = false, data = {}) {
    if (!this.e?.reply || !msg) return false
    return this.e.reply(msg, quote, data)
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
}
