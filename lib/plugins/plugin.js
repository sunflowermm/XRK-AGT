import StreamLoader from '../aistream/loader.js';

const stateArr = {}
const SymbolTimeout = Symbol("Timeout")
const SymbolResolve = Symbol("Resolve")

/**
 * 插件基类
 * 提供工作流集成和常用功能
 */
export default class plugin {
  constructor(options = {}) {
    this.name = options.name || "your-plugin"
    this.dsc = options.dsc || "无"
    this.event = options.event || "message"
    this.priority = options.priority || 5000
    this.task = options.task || { name: "", fnc: "", cron: "" }
    this.rule = options.rule || []
    this.bypassThrottle = options.bypassThrottle || false
    
    if (options.handler) {
      this.handler = options.handler
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
    const key = this.conKey(isGroup)
    if (!stateArr[key]) stateArr[key] = {}
    stateArr[key][type] = this.e
    
    if (time > 0) {
      stateArr[key][type][SymbolTimeout] = setTimeout(() => {
        if (!stateArr[key]?.[type]) return
        
        const state = stateArr[key][type]
        const resolve = state[SymbolResolve]
        
        delete stateArr[key][type]
        if (!Object.keys(stateArr[key]).length) delete stateArr[key]
        
        resolve ? resolve(false) : this.reply(timeout, true)
      }, time * 1000)
    }
    
    return stateArr[key][type]
  }

  /**
   * 获取上下文
   */
  getContext(type, isGroup = false) {
    const key = this.conKey(isGroup)
    if (!stateArr[key]) return null
    return type ? stateArr[key][type] : stateArr[key]
  }

  /**
   * 结束上下文
   */
  finish(type, isGroup = false) {
    const key = this.conKey(isGroup)
    const context = stateArr[key]?.[type]
    
    if (context) {
      const timeout = context[SymbolTimeout]
      const resolve = context[SymbolResolve]
      
      if (timeout) clearTimeout(timeout)
      if (resolve) resolve(true)
      
      delete stateArr[key][type]
      if (!Object.keys(stateArr[key]).length) delete stateArr[key]
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
    const storedContext = stateArr[key]?.["resolveContext"]
    const resolve = storedContext?.[SymbolResolve]
    
    this.finish("resolveContext")
    if (resolve && context) resolve(this.e)
  }

  /**
   * 渲染图片（保留兼容性）
   */
  async renderImg(plugin, tpl, data, cfg) {
    try {
      const Common = (await import("#miao")).Common
      if (Common?.render) {
        const renderCfg = { ...(cfg || {}), e: this.e }
        return Common.render(plugin, tpl, data, renderCfg)
      }
    } catch {}
    return null
  }
}
