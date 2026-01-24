import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import paths from '#utils/paths.js'
import os from 'os'
import cfg from '../config/config.js'
import plugin from './plugin.js'
import schedule from 'node-schedule'
import moment from 'moment'
import Handler from './handler.js'
import Runtime from './runtime.js'
import { segment } from '#oicq'
import { errorHandler, ErrorCodes } from '#utils/error-handler.js'
import { EventDeduplicator, IntelligentCache, PluginMatcher } from '#utils/neural-algorithms.js'
import { EventNormalizer } from '#utils/event-normalizer.js'

global.plugin = plugin
global.segment = segment

class PluginsLoader {
  constructor() {
    this.priority = []
    this.extended = []
    this.task = []
    this.watcher = {}
    this.cooldowns = {
      group: new Map(),
      single: new Map()
    }
    this.msgThrottle = new Map()
    this.eventThrottle = new Map()
    this.defaultMsgHandlers = []
    this.eventSubscribers = new Map()
    this.pluginCount = 0
    // 使用智能缓存替换简单数组
    this.eventHistoryCache = new IntelligentCache({ maxSize: 1000, ttl: 3600000 })
    this.eventHistory = [] // 保留用于向后兼容
    this.MAX_EVENT_HISTORY = 1000
    // 使用神经网络算法进行事件去重
    this.eventDeduplicator = new EventDeduplicator({ 
      similarityThreshold: 0.85, 
      timeWindow: 60000,
      maxHistory: 1000
    })
    // 使用智能插件匹配器
    this.pluginMatcher = new PluginMatcher()
    this.cleanupTimer = null
    this.pluginLoadStats = {
      plugins: [],
      totalLoadTime: 0,
      startTime: 0,
      totalPlugins: 0,
      taskCount: 0,
      extendedCount: 0
    }
  }

  async load(isRefresh = false) {
    try {
      if (!isRefresh && this.priority.length) return

      this.pluginLoadStats.startTime = Date.now()
      this.pluginLoadStats.plugins = []
      this.priority = []
      this.extended = []
      this.delCount()

      logger.info('--------------------------------')
      logger.title('开始加载插件', 'yellow')

      const files = await this.getPlugins()
      this.pluginCount = 0
      const packageErr = []

      // 动态批次大小（根据内存使用情况调整）
      const batchSize = this.getDynamicBatchSize()
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (file) => {
            const pluginStartTime = Date.now()
            try {
              await this.importPlugin(file, packageErr, false)
              const loadTime = Date.now() - pluginStartTime
              this.pluginLoadStats.plugins.push({ name: file.name, loadTime, success: true })
            } catch (err) {
              const loadTime = Date.now() - pluginStartTime
              this.pluginLoadStats.plugins.push({
                name: file.name,
                loadTime,
                success: false,
                error: err.message
              })
              errorHandler.handle(err, { context: 'loadPlugin', pluginName: file.name }, true)
              logger.error(`插件加载失败: ${file.name}`, err)
            }
          })
        )
      }

      this.pluginLoadStats.totalLoadTime = Date.now() - this.pluginLoadStats.startTime
      this.pluginLoadStats.totalPlugins = this.pluginCount
      this.pluginLoadStats.taskCount = this.task.length
      this.pluginLoadStats.extendedCount = this.extended.length

      this.packageTips(packageErr)
      this.createTask()
      this.initEventSystem()
      this.sortPlugins()
      this.identifyDefaultMsgHandlers()

      logger.info(`加载定时任务[${this.task.length}个]`)
      logger.info(`加载插件[${this.pluginCount}个]`)
      logger.info(`加载扩展插件[${this.extended.length}个]`)
      logger.info(`总加载耗时: ${(this.pluginLoadStats.totalLoadTime / 1000).toFixed(4)}秒`)
      
      this.analyzePluginPerformance()
    } catch (error) {
      const botError = errorHandler.handle(error, { context: 'load', code: ErrorCodes.PLUGIN_LOAD_FAILED }, true)
      logger.error('插件加载器初始化失败', botError)
      throw botError
    }
  }

  async deal(e) {
    try {
      if (!e) return

      this.normalizeEventPayload(e)
      this.initEvent(e)
      const hasBypassPlugin = await this.checkBypassPlugins(e)

      const shouldContinue = await this.preCheck(e, hasBypassPlugin)
      if (!shouldContinue) return

      const msgResult = await this.dealMsg(e)
      if (msgResult === 'return') return

      this.setupReply(e)
      await Runtime.init(e)

      await this.runPlugins(e, true)
      const handled = await this.runPlugins(e, false)

      if (!handled) logger.debug(`${e.logText} 暂无插件处理`)
    } catch (error) {
      errorHandler.handle(error, { context: 'deal', event: e?.logText, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
      logger.error('处理事件错误', error)
    }
  }

  async dealMsg(e) {
    try {
      await this.parseMessage(e)
      this.setupEventProps(e)
      this.checkPermissions(e)
      this.addUtilMethods(e)
    } catch (error) {
      errorHandler.handle(error, { context: 'dealMsg', event: e?.logText, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
      logger.error('处理消息内容错误', error)
    }
  }

  normalizeEventPayload(e) {
    if (!e) return
    
    // 使用 EventNormalizer 统一标准化
    EventNormalizer.normalizeBase(e, {
      defaultPostType: e.message_type || e.notice_type || e.request_type || e.event_type || 'message',
      defaultMessageType: e.group_id ? 'group' : 'private',
      defaultUserId: e.user_id
    })
    
    // 标准化消息字段
    EventNormalizer.normalizeMessage(e)
    
    // 标准化群组字段
    EventNormalizer.normalizeGroup(e)
    
    // 初始化扩展字段（msg由parseMessage重新构建，这里清空）
    e.msg = ''
    e.img = []
    e.video = []
    e.audio = []
    
    // 提取纯文本
    e.plainText = this.extractMessageText(e)
  }

  async parseMessage(e) {
    // 重置msg，从message数组重新构建
    e.msg = ''
    
    for (const val of e.message) {
      if (!val?.type) continue

      switch (val.type) {
        case 'text':
          e.msg += this.dealText(val.text || '')
          break
        case 'image':
          if (val.url || val.file) e.img.push(val.url || val.file)
          break
        case 'video':
          if (val.url || val.file) e.video.push(val.url || val.file)
          break
        case 'audio':
          if (val.url || val.file) e.audio.push(val.url || val.file)
          break
        case 'file':
          e.file = { name: val.name, fid: val.fid, size: val.size, url: val.url }
          if (!e.fileList) e.fileList = []
          e.fileList.push(e.file)
          break
      }
    }
  }

  setupEventProps(e) {
    if (!e) return
    
    // sender信息已由EventNormalizer和增强插件处理，这里仅补充device_name
    if (!e.sender) e.sender = {}
    if (!e.sender.nickname && e.device_name) {
      e.sender.nickname = e.device_name
      e.sender.card = e.sender.card || e.sender.nickname
    }
    
    // logText由增强插件优先设置，这里作为兜底
    if (!e.logText || e.logText.includes('未知')) {
      const scope = e.group_id ? `group:${e.group_id}` : (e.user_id || '未知')
      e.logText = `[${e.tasker || '未知'}][${scope}]`
    }
  }

  checkPermissions(e) {
    // stdin和device(web)已在事件监听器中设置isMaster，跳过
    if (e.isStdin || (e.isDevice && e.device_type === 'web')) return
    
    const masterQQ = cfg.master?.[e.self_id] || cfg.masterQQ || []
    const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]
    e.isMaster = masters.some(id => String(e.user_id) === String(id))
  }

  setupReply(e) {
    if (e._replySetup) return
    e._replySetup = true

    // 保存原始的reply方法
    e.replyNew = e.reply
    
    // 设置通用reply方法，特定适配器的增强功能由适配器增强插件处理
    e.reply = async (msg = '', quote = false, data = {}) => {
      if (!msg) return false
      
      try {
        if (!Array.isArray(msg)) msg = [msg]

        let msgRes
        try {
          msgRes = await e.replyNew(msg, false)
        } catch (err) {
          logger.debug(`发送消息错误: ${err.message}`)
          const textMsg = msg.map(m => typeof m === 'string' ? m : m?.text || '').join('')
          if (textMsg) {
            try {
              msgRes = await e.replyNew(textMsg)
            } catch (innerErr) {
              logger.debug(`纯文本发送也失败: ${innerErr.message}`)
              return { error: err }
            }
          }
        }

        this.count(e, 'send', msg)
        return msgRes
      } catch (error) {
        errorHandler.handle(error, { context: 'setupReply', code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
        logger.error('回复消息处理错误', error)
        return { error: error.message }
      }
    }
  }

  async runPlugins(e, isExtended = false) {
    if (!e) return false
    
    try {
      // 扩展插件（enhancer）在 isExtended=true 时执行
      // 普通插件在 isExtended=false 时执行，且排除 enhancer
      const plugins = await this.initPlugins(e, isExtended, !isExtended ? (meta) => meta.isEnhancer !== true : null)

      // 扩展插件直接处理规则
      if (isExtended) {
        return await this.processPlugins(plugins, e, true)
      }

      // 普通插件：先执行 accept 检查
      for (const plugin of plugins) {
        try {
          const res = await plugin.accept(e)
          
          // 处理需要重新解析消息的情况
          if (e._needReparse) {
            delete e._needReparse
            e.img = []
            e.video = []
            e.audio = []
            e.msg = ''
            await this.parseMessage(e)
          }
          
          // 如果插件返回 'return'，停止处理
          if (res === 'return') return true
          
          // 如果插件返回 false，跳过该插件
          if (res === false) continue
        } catch (error) {
          errorHandler.handle(error, { context: 'runPlugins', pluginName: plugin.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
          logger.error(`插件 ${plugin.name} accept错误`, error)
        }
      }

      // 处理上下文和限流（非设备事件）
      if (!e.isDevice) {
        if (await this.handleContext(plugins, e)) return true
        if (!plugins.some(p => p.bypassThrottle === true)) {
          this.setLimit(e)
        }
      }

      // 处理插件规则
      return await this.processPlugins(plugins, e, false)
    } catch (error) {
      errorHandler.handle(error, { context: 'runPlugins', code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
      logger.error('运行插件错误', error)
      return false
    }
  }

  async initPlugins(e, isExtended = false, filterFn = null) {
    if (!e) return []
    
    const pluginList = isExtended ? this.extended : this.priority
    const activePlugins = []

    for (const p of pluginList) {
      // 跳过无效插件
      if (!p?.class || (filterFn && !filterFn(p))) continue

      try {
        // 创建插件实例
        const plugin = new p.class(e)
        plugin.e = e
        
        // 应用规则模板
        this.applyRuleTemplates(plugin, p.ruleTemplates)
        
        // 包装 accept 方法（包含适配器检查）
        plugin.accept = this.wrapPluginAccept(plugin, p)
        plugin.bypassThrottle = p.bypassThrottle

        // 检查插件是否启用且事件匹配
        if (this.checkDisable(plugin) && this.filtEvent(e, plugin)) {
          activePlugins.push(plugin)
        }
      } catch (error) {
        errorHandler.handle(error, { context: 'initPlugins', pluginName: p.name, code: ErrorCodes.PLUGIN_LOAD_FAILED }, true)
        logger.error(`初始化插件 ${p.name} 失败`, error)
      }
    }

    return activePlugins
  }

  normalizeAdapterList(taskers) {
    if (!taskers) return []
    return (Array.isArray(taskers) ? taskers : [taskers])
      .map(item => String(item || '').toLowerCase())
      .filter(Boolean)
  }

  buildAdapterSet(plugin) {
    const taskers = this.normalizeAdapterList(plugin.taskers || plugin.tasker)
    return taskers.length ? new Set(taskers) : null
  }

  isAdapterAllowed(taskerSet, event) {
    return !taskerSet?.size || taskerSet.has(event.tasker)
  }

  wrapPluginAccept(plugin, meta) {
    const accept = typeof plugin.accept === 'function' ? plugin.accept.bind(plugin) : async () => true
    return async (event) => this.isAdapterAllowed(meta?.taskers, event) ? await accept(event) : false
  }

  async processPlugins(plugins, e, isExtended) {
    if (!Array.isArray(plugins) || !plugins.length) return false

    if (isExtended) return await this.processRules(plugins, e)

    // 按优先级分组
    const pluginsByPriority = {}
    for (const p of plugins) {
      const priority = p.priority || 50
      if (!pluginsByPriority[priority]) {
        pluginsByPriority[priority] = []
      }
      pluginsByPriority[priority].push(p)
    }
    const priorities = Object.keys(pluginsByPriority).map(Number).sort((a, b) => a - b)

    for (const priority of priorities) {
      const priorityPlugins = pluginsByPriority[priority]
      if (Array.isArray(priorityPlugins) && await this.processRules(priorityPlugins, e)) {
        return true
      }
    }

    return await this.processDefaultHandlers(e)
  }

  async processRules(plugins, e) {
    if (!Array.isArray(plugins) || !e) return false

    for (const plugin of plugins) {
      if (!plugin?.rule || !Array.isArray(plugin.rule)) continue

      for (const rule of plugin.rule) {
        // 检查事件类型匹配
        if (rule.event && !this.filtEvent(e, rule)) continue
        
        // 检查规则匹配（使用智能匹配器）
        const matchResult = this.pluginMatcher.matchRule(rule, e)
        if (!matchResult.matched) continue

        // 设置日志函数标识
        e.logFnc = `[${plugin.name}][${rule.fnc}]`
        
        // 记录日志（如果未禁用）
        if (rule.log !== false) {
          const msg = e.msg || ''
          const truncatedMsg = msg.length > 100 ? msg.substring(0, 97) + '...' : msg
          logger.info(`${e.logFnc}${e.logText} ${truncatedMsg}`)
        }

        // 检查权限
        if (!this.filtPermission(e, rule)) return true

        // 执行插件函数
        try {
          const start = Date.now()
          const fnc = plugin[rule.fnc]
          
          if (typeof fnc === 'function') {
            const res = await fnc.call(plugin, e)
            if (res !== false) {
              if (rule.log !== false) {
                logger.mark(`${e.logFnc}${e.logText} 处理完成 ${Date.now() - start}ms`)
              }
              return true
            }
          }
        } catch (error) {
          errorHandler.handle(error, { context: 'processRules', pluginName: plugin.name, rule: rule.fnc })
        }
      }
    }
    return false
  }

  async processDefaultHandlers(e) {
    if (e.isDevice) return false

    for (const handler of this.defaultMsgHandlers) {
      try {
        const plugin = new handler.class(e)
        plugin.e = e
        if (typeof plugin.handleNonMatchMsg === 'function') {
          const res = await plugin.handleNonMatchMsg(e)
          if (res === 'return' || res) return true
        }
      } catch (error) {
        errorHandler.handle(error, { context: 'processDefaultHandlers', handlerName: handler.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
        logger.error(`默认消息处理器 ${handler.name} 执行错误`, error)
      }
    }
    return false
  }

  async handleContext(plugins, e) {
    if (!Array.isArray(plugins)) return false

    for (const plugin of plugins) {
      if (!plugin?.getContext) continue

      const contexts = { ...plugin.getContext(), ...plugin.getContext(false, true) }
      if (!contexts || Object.keys(contexts).length === 0) continue

      for (const fnc in contexts) {
        if (typeof plugin[fnc] === 'function') {
          try {
            const ret = await plugin[fnc](contexts[fnc])
            if (ret !== 'continue' && ret !== false) return true
          } catch (error) {
            errorHandler.handle(error, { context: 'handleContext', pluginName: plugin.name, fnc, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
            logger.error(`上下文方法 ${fnc} 执行错误`, error)
          }
        }
      }
    }
    return false
  }

  initEvent(e) {
    if (!e) return
    
    // 确保 self_id 存在
    if (!e.self_id) {
      e.self_id = e.device_id || (e.tasker && e.tasker !== 'unknown' ? e.tasker : Bot.uin?.[0])
    }

    // 确保 bot 对象存在
    if (!e.bot) {
      const identity = e.device_id || e.self_id
      Object.defineProperty(e, 'bot', {
        value: identity && Bot[identity] ? Bot[identity] : Bot,
        writable: false,
        configurable: false
      })
    }

    // 确保 event_id 存在（如果 EventNormalizer 未设置）
    if (!e.event_id) {
      const postType = e.post_type || 'unknown'
      const randomId = Math.random().toString(36).substr(2, 9)
      e.event_id = `${e.tasker || 'event'}_${postType}_${Date.now()}_${randomId}`
    }

    // 统计接收事件
    this.count(e, 'receive')
  }

  async preCheck(e, hasBypassPlugin = false) {
    if (!e) return false
    
    try {
      // 设备和stdin事件跳过检查
      if (e.isDevice || (e.tasker || '').toLowerCase() === 'stdin') {
        return true
      }

      const botUin = e.self_id || Bot.uin?.[0]
      
      // 检查是否忽略自己发送的消息
      if (cfg.agt?.system?.ignoreSelf !== false) {
        const sameId = String(e.user_id ?? '') === String(botUin ?? '')
        if (sameId) return false
      }

      // 开机命令特殊处理
      if (/^#开机$/.test(e.plainText || '')) {
        const masterQQ = cfg.master?.[e.self_id] || cfg.masterQQ || []
        const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]
        if (masters.some(id => String(e.user_id) === String(id))) {
          return true
        }
      }

      // 检查关机状态
      const shutdownStatus = await redis.get(`Yz:shutdown:${botUin}`)
      if (shutdownStatus === 'true') {
        logger.debug(`[关机状态] 忽略消息: ${e.plainText || ''}`)
        return false
      }

      // 检查黑白名单（统一字符串比较）
      const chatbot = cfg.chatbot || {}
      const { blacklist = {}, whitelist = {} } = chatbot
      const groupId = String(e.group_id || '')
      const userId = String(e.user_id || '')
      
      // 黑名单检查
      if (blacklist.groups?.includes(groupId) || blacklist.qq?.includes(userId)) {
        return false
      }
      
      // 白名单检查（如果配置了白名单）
      if (whitelist.groups?.length && !whitelist.groups.includes(groupId)) {
        return false
      }
      if (whitelist.qq?.length && !whitelist.qq.includes(userId)) {
        return false
      }

      // bypass插件跳过限流检查
      if (hasBypassPlugin) return true

      return this.checkLimit(e)
    } catch (error) {
      errorHandler.handle(error, { context: 'preCheck', code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
      logger.error('前置检查错误', error)
      return false
    }
  }

  async checkBypassPlugins(e) {
    const text = e.plainText || ''
    if (!text) return false

    for (const p of this.priority) {
      if (!p.bypassThrottle || !p.bypassRules?.length) continue
      if (!this.isAdapterAllowed(p.taskers, e)) continue

      try {
        if (p.bypassRules.some(rule => rule.reg?.test(text))) {
          return true
        }
      } catch (error) {
        errorHandler.handle(error, { context: 'checkBypassPlugins', pluginName: p.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED }, true)
        logger.error('检查bypass插件错误', error)
      }
    }

    return false
  }

  extractMessageText(e) {
    if (e.raw_message) return this.dealText(e.raw_message)
    const messages = Array.isArray(e.message) ? e.message : (e.message ? [e.message] : [])
    const text = messages.filter(msg => msg.type === 'text').map(msg => msg.text || '').join('')
    return this.dealText(text)
  }

  addUtilMethods(e) {
    e.getSendableMedia = async (media) => {
      if (!media) return null

      try {
        if (typeof media === 'string') {
          if (media.startsWith('http')) {
            const res = await fetch(media)
            return Buffer.from(await res.arrayBuffer())
          } else if (existsSync(media)) {
            return await fs.readFile(media)
          } else if (media.startsWith('base64://')) {
            return Buffer.from(media.replace(/^base64:\/\//, ''), 'base64')
          }
        } else if (Buffer.isBuffer(media)) {
          return media
        } else if (media.file) {
          return await e.getSendableMedia(media.file)
        }
      } catch (error) {
        logger.error(`处理媒体文件失败: ${error.message}`)
      }
      return null
    }

    e.throttle = (key, duration = 1000) => {
      const userId = e.user_id || e.device_id
      const throttleKey = `${userId}:${key}`
      if (this.eventThrottle.has(throttleKey)) return false

      this.eventThrottle.set(throttleKey, Date.now())
      setTimeout(() => this.eventThrottle.delete(throttleKey), duration)
      return true
    }

    e.getEventHistory = (filter = {}) => {
      // 使用统一的过滤方法，减少冗余代码
      return this.filterEventHistory(this.eventHistory, filter)
    }
  }

  async getPlugins() {
    const ret = [];
    const { FileLoader } = await import('#utils/file-loader.js');
    const pluginDirs = await FileLoader.getCoreSubDirs('plugin');
    
    for (const pluginDir of pluginDirs) {
      try {
        const files = await FileLoader.readFiles(pluginDir, {
          ext: '.js',
          recursive: false,
          ignore: ['.', '_']
        });
        const coreDir = path.dirname(pluginDir);
        for (const filePath of files) {
          const relativePath = path.relative(paths.root, filePath);
          ret.push({
            name: path.basename(filePath),
            path: `../../../${relativePath.replace(/\\/g, '/')}`,
            core: path.basename(coreDir)
          });
        }
      } catch (error) {
        logger.error(`获取插件文件列表失败: ${pluginDir}`, error);
      }
    }
    return ret;
  }
  /**
   * 获取插件加载统计信息
   */
  getPluginStats() {
    return {
      ...this.pluginLoadStats,
      priority: this.priority.length,
      extended: this.extended.length,
      task: this.task.length
    };
  }

  prepareRuleTemplates(ruleList = []) {
    const rules = Array.isArray(ruleList) ? ruleList : [ruleList].filter(Boolean)
    return rules.map(rule => ({ ...rule, reg: rule.reg ? this.createRegExp(rule.reg) : rule.reg }))
  }

  applyRuleTemplates(plugin, templates = []) {
    if (templates.length) plugin.rule = templates
  }

  collectBypassRules(ruleTemplates = []) {
    return ruleTemplates
      .filter(rule => rule?.reg)
      .map(rule => ({ reg: rule.reg }))
  }

  /**
   * 导入插件模块（统一入口）
   * @param {Object} file - 文件信息
   * @param {Array} packageErr - 包错误收集数组
   * @returns {Promise<Object>} 导入的插件模块
   */
  async importPluginModule(file, packageErr) {
    try {
      let app = await import(file.path)
      return app.apps ? { ...app.apps } : app
    } catch (error) {
      if (error.stack?.includes('Cannot find package')) {
        packageErr.push({ error, file })
      } else {
        logger.error(`加载插件错误: ${file.name}`, error)
      }
      return {}
    }
  }

  /**
   * 初始化插件实例（异步，不阻塞）
   * @param {Object} plugin - 插件实例
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async initializePlugin(plugin) {
    if (!plugin?.init) return true

    try {
      const initRes = await Promise.race([
        plugin.init(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('init_timeout')), 3000))
      ])
      return initRes !== 'return'
    } catch (err) {
      logger.error(`插件 ${plugin.name} 初始化错误: ${err.message}`)
      return false
    }
  }

  /**
   * 注册插件定时任务
   * @param {Object} plugin - 插件实例
   * @param {string} pluginName - 插件名称
   * @param {string} pluginKey - 插件文件键名（用于卸载时匹配）
   */
  registerPluginTasks(plugin, pluginName, pluginKey) {
    if (!plugin.task) return

    const tasks = Array.isArray(plugin.task) ? plugin.task : [plugin.task]
    tasks.forEach(t => {
      if (!t?.cron || !t.fnc) return

      let fnc = t.fnc
      if (typeof fnc === 'string' && typeof plugin[fnc] === 'function') {
        fnc = plugin[fnc].bind(plugin)
      } else if (typeof fnc !== 'function') {
        logger.warn(`定时任务 ${t.name || pluginName} 的 fnc 不是函数或函数名无效，已跳过`)
        return
      }

      this.task.push({
        name: pluginKey, // 使用插件键名，便于卸载时精确匹配
        taskName: t.name || pluginName, // 保存原始任务名称用于日志
        cron: t.cron,
        fnc,
        log: t.log !== false
      })
    })
  }

  /**
   * 构建插件元数据（统一方法）
   * @param {Object} file - 文件信息
   * @param {Function} PluginClass - 插件类
   * @param {Object} plugin - 插件实例
   * @param {Array} ruleTemplates - 已准备的规则模板（必须传入）
   * @returns {Promise<Object>} 插件元数据
   */
  async buildPluginMetadata(file, PluginClass, plugin, ruleTemplates) {
    const { default: EnhancerBase } = await import('./enhancer-base.js')
    
    return {
      class: PluginClass,
      key: file.name,
      name: plugin.name,
      priority: plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50),
      plugin,
      bypassThrottle: plugin.bypassThrottle === true,
      taskers: this.buildAdapterSet(plugin),
      ruleTemplates,
      bypassRules: this.collectBypassRules(ruleTemplates),
      isEnhancer: plugin instanceof EnhancerBase
    }
  }

  /**
   * 注册插件处理器和事件订阅
   * @param {Object} plugin - 插件实例
   * @param {string} fileKey - 文件键名
   */
  registerPluginHandlers(plugin, fileKey) {
    if (plugin.handler) {
      Object.values(plugin.handler).forEach(handler => {
        if (!handler) return
        const { fn, key, priority } = handler
        Handler.add({
          ns: plugin.namespace || fileKey,
          key,
          self: plugin,
          priority: priority ?? plugin.priority,
          fn: plugin[fn]
        })
      })
    }

    if (plugin.eventSubscribe) {
      Object.entries(plugin.eventSubscribe).forEach(([eventType, handler]) => {
        if (typeof handler === 'function') {
          const boundHandler = handler.bind(plugin)
          boundHandler._pluginKey = fileKey // 标记插件键名，用于卸载时清理
          this.subscribeEvent(eventType, boundHandler)
        }
      })
    }
  }

  /**
   * 加载单个插件类（优化后的核心方法）
   * @param {Object} file - 文件信息
   * @param {Function} PluginClass - 插件类
   * @param {boolean} skipInit - 是否跳过初始化（用于热加载）
   * @returns {Promise<Object|null>} 插件元数据或null
   */
  async loadPlugin(file, PluginClass, skipInit = false) {
    try {
      if (!PluginClass?.prototype) return null

      this.pluginCount++
      const plugin = new PluginClass()

      logger.debug(`加载插件实例 [${file.name}][${plugin.name}]`)

      // 初始化插件（可跳过，用于热加载时避免重复初始化）
      if (!skipInit) {
        const initSuccess = await this.initializePlugin(plugin)
        if (!initSuccess) return null
      }

      // 准备规则模板并应用
      const ruleTemplates = this.prepareRuleTemplates(plugin.rule || [])
      this.applyRuleTemplates(plugin, ruleTemplates)

      // 注册定时任务（传入插件键名用于卸载时匹配）
      this.registerPluginTasks(plugin, plugin.name, file.name)

      // 构建插件元数据（传入已准备的规则模板）
      const pluginData = await this.buildPluginMetadata(file, PluginClass, plugin, ruleTemplates)

      // 添加到对应数组
      const targetArray = plugin.priority === 'extended' ? this.extended : this.priority
      targetArray.push(pluginData)

      // 注册处理器和事件订阅
      this.registerPluginHandlers(plugin, file.name)

      return pluginData
    } catch (error) {
      logger.error(`加载插件 ${file.name} 失败`, error)
      return null
    }
  }

  /**
   * 导入并加载插件文件（统一入口）
   * @param {Object} file - 文件信息
   * @param {Array} packageErr - 包错误收集数组
   * @param {boolean} skipInit - 是否跳过初始化
   * @returns {Promise<Array>} 加载的插件元数据数组
   */
  async importPlugin(file, packageErr, skipInit = false) {
    const app = await this.importPluginModule(file, packageErr)
    if (!app || Object.keys(app).length === 0) return []

    const results = []
    for (const [key, PluginClass] of Object.entries(app)) {
      const pluginData = await this.loadPlugin(file, PluginClass, skipInit)
      if (pluginData) results.push(pluginData)
    }
    return results
  }

  identifyDefaultMsgHandlers() {
    this.defaultMsgHandlers = this.priority.filter(p => {
      if (!p?.class) return false
      try {
        return typeof new p.class().handleNonMatchMsg === 'function'
      } catch {
        return false
      }
    })
  }

  packageTips(packageErr) {
    if (!packageErr?.length) return
    logger.error('--------- 插件加载错误 ---------')
    packageErr.forEach(({ error, file }) => {
      const pack = error.stack?.match(/'(.+?)'/g)?.[0]?.replace(/'/g, '') || '未知依赖'
      logger.warning(`${file.name} 缺少依赖: ${pack}`)
    })
    logger.error(`安装插件后请 pnpm i 安装依赖`)
    logger.error('--------------------------------')
  }

  sortPlugins() {
    // 按优先级排序
    this.priority.sort((a, b) => (a.priority || 50) - (b.priority || 50))
    this.extended.sort((a, b) => (a.priority || 50) - (b.priority || 50))
  }

  filtEvent(e, v) {
    if (!v.event) return true

    const pluginEvent = v.event
    const possibleEvents = []
    const genericEvents = []
    const tasker = e.tasker || ''
    const postType = e.post_type || ''
    const subType = e.sub_type || ''

    // 细分类型字段（兼容 message/notice/request/guild 等）
    const detailType =
      e.message_type ||
      e.notice_type ||
      e.request_type ||
      e.detail_type ||
      e.event_type ||
      ''

    // 构建可能的事件键（从具体到通用），适配任意新适配器
    if (tasker && tasker !== 'unknown') {
      if (postType && detailType && subType) possibleEvents.push(`${tasker}.${postType}.${detailType}.${subType}`)
      if (postType && detailType) possibleEvents.push(`${tasker}.${postType}.${detailType}`)
      if (postType) possibleEvents.push(`${tasker}.${postType}`)
      if (detailType) possibleEvents.push(`${tasker}.${detailType}`)
      possibleEvents.push(tasker)
    }

    // 通用事件（无适配器前缀）
    if (postType && detailType && subType) possibleEvents.push(`${postType}.${detailType}.${subType}`)
    if (postType && detailType) possibleEvents.push(`${postType}.${detailType}`)
    if (detailType) possibleEvents.push(detailType)
    if (postType) {
      possibleEvents.push(postType)
      genericEvents.push(postType)
    }
    
    // 检查完全匹配
    for (const actualEvent of possibleEvents) {
      if (pluginEvent === actualEvent || this.matchEventPattern(pluginEvent, actualEvent)) {
        return true
      }
    }
    
    // 检查通用事件匹配（如 'message' 匹配所有 message.* 事件）
    if (!pluginEvent.includes('.')) {
      return genericEvents.includes(pluginEvent)
    }
    
    // 检查通配符匹配（如 'stdin.*' 或 'onebot.message.*'）
    const adapterPrefix = pluginEvent.split('.')[0]
    if (pluginEvent.endsWith('.*') || pluginEvent === adapterPrefix) {
      return possibleEvents.some(ev => ev.startsWith(`${adapterPrefix}.`) || ev === adapterPrefix)
    }
    
    return false
  }

  matchEventPattern(pattern, event) {
    if (pattern === event) return true
    if (!pattern.includes('*')) return false
    
    const patternParts = pattern.split('.')
    const eventParts = event.split('.')
    
    if (patternParts.length !== eventParts.length) return false
    
    return patternParts.every((part, i) => {
      if (part === '*') return true
      return part === eventParts[i]
    })
  }

  filtPermission(e, v) {
    if (e.isDevice) return true
    if (!v.permission || v.permission === 'all' || e.isMaster) return true

    switch (v.permission) {
      case 'master':
        if (!e.isMaster) {
          e.reply('暂无权限，只有主人才能操作')
          return false
        }
        return true

      case 'owner':
        // 检查是否为群主（由适配器增强插件设置相关属性）
        if (!e.isGroup || !e.member?.is_owner) {
          e.reply('暂无权限，只有群主才能操作')
          return false
        }
        return true

      case 'admin':
        // 检查是否为管理员（由适配器增强插件设置相关属性）
        if (!e.isGroup || (!e.member?.is_owner && !e.member?.is_admin)) {
          e.reply('暂无权限，只有管理员才能操作')
          return false
        }
        return true

      default:
        return true
    }
  }

  checkLimit(e) {
    if (e.isDevice) return true

    if (!e.message || !e.group_id || ['cmd'].includes(e.tasker)) {
      return true
    }

    const config = cfg.getGroup(e.group_id) || {}
    const groupCD = config.groupGlobalCD || 0
    const singleCD = config.singleCD || 0

    if ((groupCD > 0 && this.cooldowns.group.has(e.group_id)) ||
      (singleCD > 0 && this.cooldowns.single.has(`${e.group_id}.${e.user_id}`))) {
      return false
    }

    const msgId = e.message_id ?
      `${e.user_id}:${e.message_id}` :
      `${e.user_id}:${Date.now()}:${Math.random()}`

    if (this.msgThrottle.has(msgId)) return false

    this.msgThrottle.set(msgId, Date.now())
    setTimeout(() => this.msgThrottle.delete(msgId), 5000)

    return true
  }

  setLimit(e) {
    if (e.isDevice || !e.message || !e.group_id || ['cmd'].includes(e.tasker)) return

    const config = cfg.getGroup(e.group_id) || {}
    const groupCD = config.groupGlobalCD || 0
    const singleCD = config.singleCD || 0

    if (groupCD > 0) {
      this.cooldowns.group.set(e.group_id, Date.now())
      setTimeout(() => this.cooldowns.group.delete(e.group_id), groupCD)
    }

    if (singleCD > 0) {
      const key = `${e.group_id}.${e.user_id}`
      this.cooldowns.single.set(key, Date.now())
      setTimeout(() => this.cooldowns.single.delete(key), singleCD)
    }
  }


  checkDisable(p) {
    if (!p) return false
    
    // 如果没有事件对象，直接返回插件本身的有效性
    if (!p.e) return !!p
    
    // 设备和私聊事件不检查群组配置
    if (p.e.isDevice || !p.e.group_id) return true

    // 检查群组配置
    const groupCfg = cfg.getGroup(p.e.group_id) || {}
    const { disable = [], enable = [] } = groupCfg

    // 如果在禁用列表中，返回 false
    if (disable.includes(p.name)) return false
    
    // 如果配置了启用列表，检查是否在列表中
    return enable.length === 0 || enable.includes(p.name)
  }

  createRegExp(pattern) {
    if (pattern instanceof RegExp) return pattern
    if (typeof pattern !== 'string') return false
    if (pattern === 'null' || pattern === '') return /.*/
    try {
      return new RegExp(pattern)
    } catch (e) {
      logger.error(`正则表达式创建失败: ${pattern}`, e)
      return false
    }
  }

  /**
   * 处理文本规范化
   * @param {string} text - 文本内容
   * @returns {string}
   */
  dealText(text = '') {
    text = String(text ?? '')
    if (cfg.agt?.system?.['/→#']) text = text.replace(/^\s*\/\s*/, '#')
    return text
      .replace(/^\s*[＃井#]+\s*/, '#')
      .replace(/^\s*[\\*※＊]+\s*/, '*')
      .trim()
  }

  initEventSystem() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)

    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupEventHistory()
        this.cleanupThrottles()
        this.cleanupCooldowns()
      } catch (error) {
        errorHandler.handle(error, { context: 'cleanupTimer' })
      }
    }, 60000)
  }

  /**
   * 统一的事件历史清理（使用智能缓存）
   */
  cleanupEventHistory() {
    // 智能缓存会自动清理过期项
    if (this.eventHistory.length > this.MAX_EVENT_HISTORY) {
      this.eventHistory = this.eventHistory.slice(-this.MAX_EVENT_HISTORY)
    }
  }

  /**
   * 统一的节流清理
   */
  cleanupThrottles() {
    const now = Date.now()
    for (const [key, time] of this.eventThrottle) {
      if (now - time > 60000) this.eventThrottle.delete(key)
    }
    for (const [key, time] of this.msgThrottle) {
      if (now - time > 5000) this.msgThrottle.delete(key)
    }
  }

  /**
   * 统一的冷却清理
   */
  cleanupCooldowns() {
    const now = Date.now()
    for (const cooldownType of ['group', 'single']) {
      const cooldownMap = this.cooldowns[cooldownType]
      if (cooldownMap instanceof Map) {
        for (const [key, time] of cooldownMap) {
          if (now - time > 300000) {
            cooldownMap.delete(key)
          }
        }
      }
    }
  }

  /**
   * 统一的事件历史过滤方法（减少冗余代码）
   */
  filterEventHistory(history, filter = {}) {
    let filtered = [...history]

    if (filter.event_type) {
      filtered = filtered.filter(h => h.event_type === filter.event_type)
    }
    if (filter.user_id) {
      filtered = filtered.filter(h => h.event_data?.user_id === filter.user_id)
    }
    if (filter.device_id) {
      filtered = filtered.filter(h => h.event_data?.device_id === filter.device_id)
    }
    if (filter.limit && typeof filter.limit === 'number') {
      filtered = filtered.slice(0, filter.limit)
    }

    return filtered
  }

  recordEventHistory(eventType, eventData) {
    // 使用事件去重器检查是否重复
    if (this.eventDeduplicator.isDuplicate(eventData)) {
      // debug: 重复事件是内部技术细节
      logger.debug(`事件去重: ${eventType} - ${eventData.event_id || 'unknown'}`)
      return
    }

    const historyEntry = {
      event_id: eventData.event_id || Date.now().toString(),
      event_type: eventType,
      event_data: eventData,
      timestamp: Date.now(),
      source: eventData.tasker || eventData.device_id || 'internal'
    }

    // 同时存储到智能缓存和数组（向后兼容）
    const cacheKey = `${eventType}:${historyEntry.event_id}`
    this.eventHistoryCache.set(cacheKey, historyEntry)
    this.eventHistory.unshift(historyEntry)

    if (this.eventHistory.length > this.MAX_EVENT_HISTORY * 1.5) {
      this.eventHistory = this.eventHistory.slice(0, this.MAX_EVENT_HISTORY)
    }
  }

  distributeToSubscribers(eventType, eventData) {
    const subscribers = this.eventSubscribers.get(eventType)
    if (!subscribers || subscribers.length === 0) return

    subscribers.forEach(callback => {
      try {
        callback(eventData)
      } catch (error) {
        logger.error(`事件订阅回调执行失败 [${eventType}]`)
        logger.error(error)
      }
    })
  }

  subscribeEvent(eventType, callback) {
    if (typeof eventType !== 'string' || !eventType.trim() || typeof callback !== 'function') {
      return () => {}
    }

    eventType = eventType.trim()
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, [])
    }
    this.eventSubscribers.get(eventType).push(callback)

    return () => {
      const subscribers = this.eventSubscribers.get(eventType)
      const index = subscribers?.indexOf(callback)
      if (index > -1) subscribers.splice(index, 1)
    }
  }

  createTask() {
    const created = new Set()

    for (const task of this.task) {
      task.job?.cancel()

      // 使用任务名称（如果有）或插件键名
      const taskDisplayName = task.taskName || task.name
      const name = `[${taskDisplayName}][${task.cron}]`
      if (created.has(name)) {
        logger.warn(`重复定时任务 ${name} 已跳过`)
        continue
      }

      created.add(name)
      logger.debug(`加载定时任务 ${name}`)

      const cronExp = task.cron.split(/\s+/).slice(0, 6).join(' ')
      task.job = schedule.scheduleJob(cronExp, async () => {
        try {
          const start = Date.now()
          if (task.log) logger.mark(`${name} 开始执行`)
          await task.fnc()
          if (task.log) logger.mark(`${name} 执行完成 ${Date.now() - start}ms`)
        } catch (err) {
          logger.error(`定时任务 ${name} 执行失败`, err)
        }
      })
    }
  }

  async count(e, type, msg) {
    if (e.isDevice) return

    try {
      const checkImg = item => {
        if (item?.type === 'image' && item.file && Buffer.isBuffer(item.file)) {
          this.saveCount('screenshot', e.group_id)
        }
      }
      Array.isArray(msg) ? msg.forEach(checkImg) : checkImg(msg)
      if (type === 'send') this.saveCount('sendMsg', e.group_id)
    } catch (error) {
      logger.debug(`统计计数失败: ${error.message}`)
    }
  }

  async saveCount(type, groupId = '') {
    try {
      const base = groupId ? `Yz:count:group:${groupId}:` : 'Yz:count:'
      const dayKey = `${base}${type}:day:${moment().format('MMDD')}`
      const monthKey = `${base}${type}:month:${moment().month() + 1}`
      const keys = [dayKey, monthKey]

      if (!groupId) {
        keys.push(`${base}${type}:total`)
      }

      for (const key of keys) {
        await redis.incr(key)
        if (key.includes(':day:') || key.includes(':month:')) {
          await redis.expire(key, 3600 * 24 * 30)
        }
      }
    } catch (error) {
      logger.debug(`保存计数失败: ${error.message}`)
    }
  }

  /**
   * 删除计数
   */
  async delCount() {
    try {
      await Promise.all([
        redis.set('Yz:count:sendMsg:total', '0'),
        redis.set('Yz:count:screenshot:total', '0')
      ])
    } catch (error) {
      logger.debug(`删除计数失败: ${error.message}`)
    }
  }

  /**
   * 卸载插件（清理相关资源）
   * @param {string} key - 插件文件名（不含扩展名）
   */
  unloadPlugin(key) {
    // 清理定时任务（精确匹配插件键名）
    this.task = this.task.filter(task => {
      if (task.name === key) {
        task.job?.cancel()
        return false
      }
      return true
    })

    // 清理插件数组
    const removedPlugins = []
    this.priority = this.priority.filter(p => {
      if (p.key === key) {
        removedPlugins.push(p)
        return false
      }
      return true
    })
    this.extended = this.extended.filter(p => {
      if (p.key === key) {
        removedPlugins.push(p)
        return false
      }
      return true
    })

    // 清理 Handler（使用插件的命名空间）
    for (const pluginData of removedPlugins) {
      const namespace = pluginData.plugin?.namespace || key
      Handler.del(namespace)
    }

    // 清理事件订阅（需要遍历所有订阅者找到对应的插件）
    for (const [eventType, subscribers] of this.eventSubscribers) {
      const filtered = subscribers.filter(sub => {
        return !sub._pluginKey || sub._pluginKey !== key
      })
      if (filtered.length !== subscribers.length) {
        this.eventSubscribers.set(eventType, filtered)
      }
    }

    // 重新识别默认消息处理器
    this.identifyDefaultMsgHandlers()
  }

  /**
   * 查找插件文件路径
   * @param {string} key - 插件文件名（不含扩展名）
   * @returns {Promise<string|null>} 插件文件路径或null
   */
  async findPluginFilePath(key) {
    try {
      const { FileLoader } = await import('#utils/file-loader.js')
      const pluginDirs = await FileLoader.getCoreSubDirs('plugin')
      
      for (const pluginDir of pluginDirs) {
        const filePath = path.join(pluginDir, `${key}.js`)
        if (existsSync(filePath)) {
          return filePath
        }
      }
      return null
    } catch (error) {
      logger.error(`查找插件文件失败: ${key}`, error)
      return null
    }
  }

  /**
   * 构建插件文件对象（用于导入）
   * @param {string} filePath - 文件绝对路径
   * @param {string} key - 插件键名
   * @returns {Object} 文件对象
   */
  buildPluginFileObject(filePath, key) {
    const relativePath = path.relative(paths.root, filePath)
    return {
      name: key,
      path: `../../../${relativePath.replace(/\\/g, '/')}?${Date.now()}`
    }
  }

  /**
   * 热更新插件（优化后的方法）
   * @param {string} key - 插件文件名（不含扩展名）
   */
  async changePlugin(key) {
    if (!key) {
      logger.error('热更新插件: 缺少插件key')
      return
    }
    
    try {
      // 查找插件文件
      const pluginPath = await this.findPluginFilePath(key)
      if (!pluginPath) {
        logger.error(`插件文件未找到: ${key}`)
        return
      }
      
      // 先卸载旧插件
      this.unloadPlugin(key)
      
      // 构建文件对象并重新加载插件（热加载时需要重新初始化，确保插件状态正确）
      const file = this.buildPluginFileObject(pluginPath, key)
      const loadedPlugins = await this.importPlugin(file, [], false)
      
      if (loadedPlugins.length > 0) {
        // 重新创建定时任务
        this.createTask()
        // 重新排序和识别
        this.sortPlugins()
        this.identifyDefaultMsgHandlers()
        logger.mark(`[热更新插件][${key}] 更新了 ${loadedPlugins.length} 个插件实例`)
      } else {
        logger.warn(`[热更新插件][${key}] 未成功加载任何插件实例`)
      }
    } catch (error) {
      errorHandler.handle(error, { context: 'changePlugin', pluginKey: key, code: ErrorCodes.PLUGIN_LOAD_FAILED }, true)
      logger.error(`热更新插件错误: ${key}`, error)
    }
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      if (this.watcher.dir) {
        await this.watcher.dir.close()
        delete this.watcher.dir
      }
      logger.debug('插件文件监视已停止')
      return
    }

    if (this.watcher.dir) {
      logger.debug('插件文件监视已启动')
      return
    }

    try {
      const { HotReloadBase } = await import('#utils/hot-reload-base.js')
      const hotReload = new HotReloadBase({ loggerName: 'PluginsLoader' })
      
      const pluginDirs = await paths.getCoreSubDirs('plugin')
      if (pluginDirs.length === 0) {
        logger.debug('未找到 plugin 目录，跳过文件监视')
        return
      }

      await hotReload.watch(true, {
        dirs: pluginDirs,
        onAdd: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          logger.mark(`[新增插件][${key}]`)
          try {
            const file = this.buildPluginFileObject(filePath, key)
            const loadedPlugins = await this.importPlugin(file, [], false)
            if (loadedPlugins.length > 0) {
              this.createTask()
              // initEventSystem 只需要初始化一次，不需要在热加载时重复调用
              this.sortPlugins()
              this.identifyDefaultMsgHandlers()
              logger.mark(`[新增插件][${key}] 成功加载 ${loadedPlugins.length} 个插件实例`)
            }
          } catch (error) {
            logger.error(`[新增插件][${key}] 加载失败`, error)
          }
        },
        onChange: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          logger.mark(`[修改插件][${key}]`)
          await this.changePlugin(key)
        },
        onUnlink: async (filePath) => {
          const key = hotReload.getFileKey(filePath)
          logger.mark(`[删除插件][${key}]`)
          this.unloadPlugin(key)
          logger.mark(`[删除插件][${key}] 已清理所有相关资源`)
        }
      })

      this.watcher.dir = hotReload.watcher
      logger.debug('插件文件监视已启动')
    } catch (error) {
      logger.error('启动插件文件监视失败', error)
    }
  }


  async emit(eventType, eventData) {
    try {
      const postType = eventType.split('.')[0] || 'custom'
      const randomId = Math.random().toString(36).substr(2, 9)
      const event = {
        ...eventData,
        post_type: postType,
        event_type: eventType,
        time: Math.floor(Date.now() / 1000),
        event_id: `custom_${Date.now()}_${randomId}`
      }

      this.recordEventHistory(eventType, event)
      Bot.em(eventType, event)
      this.distributeToSubscribers(eventType, event)

      return { success: true, event_id: event.event_id }
    } catch (error) {
      logger.error('触发自定义事件失败', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取动态批次大小（根据内存使用情况）
   */
  getDynamicBatchSize() {
    try {
      const totalMemory = os.totalmem()
      const freeMemory = os.freemem()
      const memoryUsage = (totalMemory - freeMemory) / totalMemory
      if (memoryUsage > 0.8) return 5
      if (memoryUsage > 0.6) return 8
      return 10
    } catch (error) {
      logger.debug(`获取内存信息失败，使用默认批次大小: ${error.message}`)
      return 10
    }
  }

  /**
   * 分析插件加载性能
   */
  analyzePluginPerformance() {
    try {
      const slowPlugins = this.pluginLoadStats.plugins
        .filter(p => p.loadTime > 1000)
        .sort((a, b) => b.loadTime - a.loadTime)
      
      if (slowPlugins.length > 0) {
        logger.warn(`发现 ${slowPlugins.length} 个加载较慢的插件:`)
        slowPlugins.slice(0, 5).forEach(p => logger.warn(`  - ${p.name}: ${p.loadTime}ms`))
      }
      
      const avgLoadTime = this.pluginLoadStats.plugins.length > 0
        ? this.pluginLoadStats.plugins.reduce((sum, p) => sum + p.loadTime, 0) / this.pluginLoadStats.plugins.length
        : 0
      logger.debug(`平均插件加载时间: ${avgLoadTime.toFixed(2)}ms`)
    } catch (error) {
      logger.debug(`性能分析失败: ${error.message}`)
    }
  }

  async destroy() {
    try {
      this.task.forEach(task => task.job?.cancel())
      await Promise.allSettled(Object.values(this.watcher).map(watcher => watcher?.close?.()))
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer)
        this.cleanupTimer = null
      }

      this.priority = []
      this.extended = []
      this.task = []
      this.watcher = {}
      this.cooldowns.group.clear()
      this.cooldowns.single.clear()
      this.msgThrottle.clear()
      this.eventThrottle.clear()
      this.eventSubscribers.clear()
      this.eventHistory = []

      logger.info('插件加载器已销毁')
    } catch (error) {
      errorHandler.handle(error, { context: 'destroy', code: ErrorCodes.SYSTEM_ERROR }, true)
      logger.error('销毁插件加载器失败', error)
    }
  }

}

export default new PluginsLoader()