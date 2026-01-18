import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import paths from '#utils/paths.js'
import lodash from 'lodash'
import os from 'os'
import cfg from '../config/config.js'
import plugin from './plugin.js'
import schedule from 'node-schedule'
import chokidar from 'chokidar'
import moment from 'moment'
import Handler from './handler.js'
import Runtime from './runtime.js'
import { segment } from '#oicq'
import { errorHandler, ErrorCodes } from '#utils/error-handler.js'
import { EventDeduplicator, IntelligentCache, PluginMatcher } from '#utils/neural-algorithms.js'

global.plugin = plugin
global.segment = segment

class PluginsLoader {
  constructor() {
    this.priority = []
    this.extended = []
    this.task = []
    this.dir = 'core' // 改为扫描所有 core 目录
    this.watcher = {}
    this.cooldowns = {
      group: new Map(),
      single: new Map(),
      device: new Map()
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
            const pluginStartTime = Date.now();
            try {
              await this.importPlugin(file, packageErr);
              const loadTime = Date.now() - pluginStartTime;

              this.pluginLoadStats.plugins.push({
                name: file.name,
                loadTime: loadTime,
                success: true
              });
            } catch (err) {
              const loadTime = Date.now() - pluginStartTime;
              this.pluginLoadStats.plugins.push({
                name: file.name,
                loadTime: loadTime,
                success: false,
                error: err.message
              });

              // 使用标准化错误处理
              const botError = errorHandler.handle(
                err,
                { context: 'loadPlugin', pluginName: file.name },
                true
              )
              logger.error(`插件加载失败: ${file.name}`)
              logger.error(botError)
              return null
            }
          })
        )
      }

      this.pluginLoadStats.totalLoadTime = Date.now() - this.pluginLoadStats.startTime;
      this.pluginLoadStats.totalPlugins = this.pluginCount;
      this.pluginLoadStats.taskCount = this.task.length;
      this.pluginLoadStats.extendedCount = this.extended.length;

      this.packageTips(packageErr)
      this.createTask()
      this.initEventSystem()
      this.sortPlugins()
      this.identifyDefaultMsgHandlers()

      // info: 插件加载结果是重要的业务信息
      logger.info(`加载定时任务[${this.task.length}个]`)
      logger.info(`加载插件[${this.pluginCount}个]`)
      logger.info(`加载扩展插件[${this.extended.length}个]`)
      logger.info(`总加载耗时: ${(this.pluginLoadStats.totalLoadTime / 1000).toFixed(4)}秒`)
      
      // 性能分析
      this.analyzePluginPerformance()
    } catch (error) {
      const botError = errorHandler.handle(
        error,
        { context: 'load', code: ErrorCodes.PLUGIN_LOAD_FAILED },
        true
      )
      logger.error('插件加载器初始化失败')
      logger.error(botError)
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

      if (!handled) {
        // debug: 无插件处理是技术细节
        logger.debug(`${e.logText} 暂无插件处理`)
      }
    } catch (error) {
      // 使用标准化错误处理
      errorHandler.handle(
        error,
        { context: 'deal', event: e?.logText, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
        true
      )
      logger.error('处理事件错误')
      logger.error(error)
    }
  }

  async dealMsg(e) {
    try {
      this.initMsgProps(e)
      await this.parseMessage(e)
      this.setupEventProps(e)
      this.checkPermissions(e)
      this.addUtilMethods(e)
    } catch (error) {
      // 使用标准化错误处理
      errorHandler.handle(
        error,
        { context: 'dealMsg', event: e?.logText, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
        true
      )
      logger.error('处理消息内容错误')
      logger.error(error)
    }
  }

  initMsgProps(e) {
    e.img = []
    e.video = []
    e.audio = []
    e.msg = ''
    if (!Array.isArray(e.message)) e.message = []
  }

  normalizeEventPayload(e) {
    // 统一事件基础字段，减少后续重复存在性判断
    e.tasker = String(e.tasker || e.tasker_name || 'unknown').toLowerCase()
    if (!Array.isArray(e.message)) e.message = e.message ? [e.message] : []
    e.raw_message ||= ''
    e.sender ||= {}

    if (!e.post_type) {
      e.post_type = e.message_type || e.notice_type || e.request_type || e.event_type || ''
    }

    // 预先提取纯文本，避免后续重复判断
    e.plainText = this.extractMessageText(e)
  }

  async parseMessage(e) {
    // 通用消息解析，只处理通用类型
    // 特定适配器的消息类型（如at、reply等）应由对应适配器的增强插件处理
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
          e.file = {
            name: val.name,
            fid: val.fid,
            size: val.size,
            url: val.url
          }
          if (!e.fileList) e.fileList = []
          e.fileList.push(e.file)
          break
        // 特定适配器的消息类型（at、reply、face等）由适配器增强插件处理
      }
    }
  }

  setupEventProps(e) {
    // 基础sender信息
    e.sender.nickname ||= e.sender.card || e.device_name || ''
    e.sender.card ||= e.sender.nickname
    if (!e.logText) {
      e.logText = `[${e.tasker || '未知'}][${e.user_id || '未知'}]`
    }
  }

  checkPermissions(e) {
    const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || []
    const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]

    if (masters.some(id => String(e.user_id) === String(id))) {
      e.isMaster = true
    }
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
          // debug: 发送失败是技术细节，不影响业务流程
          logger.debug(`发送消息错误: ${err.message}`)
          const textMsg = msg.map(m => typeof m === 'string' ? m : m?.text || '').join('')
          if (textMsg) {
            try {
              msgRes = await e.replyNew(textMsg)
            } catch (innerErr) {
              // debug: 重试失败是技术细节
              logger.debug(`纯文本发送也失败: ${innerErr.message}`)
              return { error: err }
            }
          }
        }

        this.count(e, 'send', msg)
        return msgRes
      } catch (error) {
        errorHandler.handle(
          error,
          { context: 'setupReply', code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
          true
        )
        logger.error('回复消息处理错误')
        logger.error(error)
        return { error: error.message }
      }
    }
  }

  async runPlugins(e, isExtended = false) {
    try {
      const plugins = await this.initPlugins(
        e,
        isExtended,
        !isExtended ? (meta) => meta.isEnhancer !== true : null
      )

      if (isExtended) {
        return await this.processPlugins(plugins, e, true)
      }

      for (const plugin of plugins) {
        try {
          const res = await plugin.accept(e)

          if (e._needReparse) {
            delete e._needReparse
            this.initMsgProps(e)
            await this.parseMessage(e)
          }

          if (res === 'return') return true
          if (res === false) continue
        } catch (error) {
          errorHandler.handle(
            error,
            { context: 'runPlugins', pluginName: plugin.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
            true
          )
          logger.error(`插件 ${plugin.name} accept错误`)
          logger.error(error)
        }
      }

      if (!e.isDevice) {
        if (await this.handleContext(plugins, e)) return true

        const shouldSetLimit = !plugins.some(p => p.bypassThrottle === true)
        if (shouldSetLimit) this.setLimit(e)
      }

      return await this.processPlugins(plugins, e, false)
    } catch (error) {
      errorHandler.handle(
        error,
        { context: 'runPlugins', code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
        true
      )
      logger.error('运行插件错误')
      logger.error(error)
      return false
    }
  }

  async initPlugins(e, isExtended = false) {
    const pluginList = isExtended ? this.extended : this.priority
    const activePlugins = []

    for (const p of pluginList) {
      if (!p?.class) continue

      try {
        const plugin = new p.class(e)
        plugin.e = e
        this.applyRuleTemplates(plugin, p.ruleTemplates)
        plugin.accept = this.wrapPluginAccept(plugin, p)
        plugin.bypassThrottle = p.bypassThrottle

        if (this.checkDisable(plugin) && this.filtEvent(e, plugin)) {
          activePlugins.push(plugin)
        }
      } catch (error) {
        errorHandler.handle(
          error,
          { context: 'initPlugins', pluginName: p.name, code: ErrorCodes.PLUGIN_LOAD_FAILED },
          true
        )
        logger.error(`初始化插件 ${p.name} 失败`)
        logger.error(error)
      }
    }

    return activePlugins
  }

  normalizeAdapterList(taskers) {
    if (!taskers) return []
    const list = Array.isArray(taskers) ? taskers : [taskers]
    return list
      .map(item => String(item || '').toLowerCase())
      .filter(Boolean)
  }

  buildAdapterSet(plugin) {
    const taskers = this.normalizeAdapterList(plugin.taskers || plugin.tasker)
    return taskers.length ? new Set(taskers) : null
  }

  isAdapterAllowed(taskerSet, event) {
    if (!taskerSet || taskerSet.size === 0) return true
    return taskerSet.has(event.tasker)
  }

  wrapPluginAccept(plugin, meta) {
    const taskers = meta?.taskers
    const accept = typeof plugin.accept === 'function'
      ? plugin.accept.bind(plugin)
      : async () => true

    return async (event) => {
      if (!this.isAdapterAllowed(taskers, event)) {
        return false
      }
      return await accept(event)
    }
  }

  async processPlugins(plugins, e, isExtended) {
    if (!Array.isArray(plugins)) {
      // warn: 参数错误需要关注但不影响运行
      logger.warn('processPlugins: plugins参数不是数组')
      return false
    }

    if (!plugins.length) return false

    if (isExtended) {
      return await this.processRules(plugins, e)
    }

    const pluginsByPriority = lodash.groupBy(plugins, 'priority')
    const priorities = Object.keys(pluginsByPriority)
      .map(Number)
      .sort((a, b) => a - b)

    for (const priority of priorities) {
      const priorityPlugins = pluginsByPriority[priority]
      if (!Array.isArray(priorityPlugins)) continue

      const handled = await this.processRules(priorityPlugins, e)
      if (handled) return true
    }

    return await this.processDefaultHandlers(e)
  }

  async processRules(plugins, e) {
    if (!Array.isArray(plugins)) {
      // warn: 参数错误需要关注但不影响运行
      logger.warn('processRules: plugins参数不是数组')
      return false
    }

    for (const plugin of plugins) {
      if (!plugin?.rule) continue

      for (const v of plugin.rule) {
        if (v.event && !this.filtEvent(e, v)) continue
        
        // 使用智能匹配器替换简单正则测试
        const matchResult = this.pluginMatcher.matchRule(v, e)
        if (!matchResult.matched) continue

        e.logFnc = `[${plugin.name}][${v.fnc}]`

        if (v.log !== false) {
          // info: 插件执行是重要的业务信息
          logger.info(`${e.logFnc}${e.logText} ${lodash.truncate(e.msg || '', { length: 100 })}`)
        }

        if (!this.filtPermission(e, v)) return true

        try {
          const start = Date.now()

          if (typeof plugin[v.fnc] === 'function') {
            const res = await plugin[v.fnc](e)

            if (res !== false) {
              if (v.log !== false) {
                logger.mark(`${e.logFnc}${e.logText} 处理完成 ${Date.now() - start}ms`)
              }
              return true
            }
          }
        } catch (error) {
          errorHandler.handle(error, { context: 'processRules', pluginName: plugin.name, rule: v.fnc })
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
        errorHandler.handle(
          error,
          { context: 'processDefaultHandlers', handlerName: handler.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
          true
        )
        logger.error(`默认消息处理器 ${handler.name} 执行错误`)
        logger.error(error)
      }
    }
    return false
  }

  async handleContext(plugins, e) {
    if (!Array.isArray(plugins)) return false

    for (const plugin of plugins) {
      if (!plugin?.getContext) continue

      const contexts = {
        ...plugin.getContext(),
        ...plugin.getContext(false, true)
      }

      if (!lodash.isEmpty(contexts)) {
        for (const fnc in contexts) {
          if (typeof plugin[fnc] === 'function') {
            try {
              const ret = await plugin[fnc](contexts[fnc])
              if (ret !== 'continue' && ret !== false) return true
            } catch (error) {
              errorHandler.handle(
                error,
                { context: 'handleContext', pluginName: plugin.name, fnc, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
                true
              )
              logger.error(`上下文方法 ${fnc} 执行错误`)
              logger.error(error)
            }
          }
        }
      }
    }
    return false
  }

  initEvent(e) {
    const taskerName = e.tasker

    if (!e.self_id) {
      if (e.device_id) {
        e.self_id = e.device_id
      } else if (taskerName && taskerName !== 'unknown') {
        e.self_id = taskerName
      } else if (Bot.uin?.length > 0) {
        e.self_id = Bot.uin[0]
      }
    }

    const identity = e.device_id || e.self_id
    const bot = (identity && Bot[identity]) ? Bot[identity] : Bot

    if (!e.bot) {
      Object.defineProperty(e, 'bot', {
        value: bot,
        writable: false,
        configurable: false
      })
    }

    if (!e.event_id) {
      const postType = e.post_type || 'unknown'
      const randomId = Math.random().toString(36).substr(2, 9)
      e.event_id = `${e.tasker || 'event'}_${postType}_${Date.now()}_${randomId}`
    }

    this.count(e, 'receive')
  }

  async preCheck(e, hasBypassPlugin = false) {
    try {
      if (e.isDevice) return true
      if ((e.tasker || '').toLowerCase() === 'stdin') return true

      const botUin = e.self_id || Bot.uin?.[0]
      // 关键修复：不同适配器/平台可能把ID解析成 string/number，严格相等会失效
      // 这里统一用字符串比较，确保 ignore_self 在 Linux/Windows 行为一致
      const sameId = String(e.user_id ?? '') === String(botUin ?? '')
      if (cfg.bot?.ignore_self !== false && sameId) {
        return false
      }

      const msg = e.plainText || ''
      if (/^#开机$/.test(msg)) {
        const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || []
        const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]
        if (masters.some(id => String(e.user_id) === String(id))) {
          return true
        }
      }

      const shutdownStatus = await redis.get(`Yz:shutdown:${botUin}`)
      if (shutdownStatus === 'true') {
        logger.debug(`[关机状态] 忽略消息: ${msg}`)
        return false
      }

      if (hasBypassPlugin) return true

      return this.checkLimit(e)
    } catch (error) {
      errorHandler.handle(
        error,
        { context: 'preCheck', code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
        true
      )
      logger.error('前置检查错误')
      logger.error(error)
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
        errorHandler.handle(
          error,
          { context: 'checkBypassPlugins', pluginName: p.name, code: ErrorCodes.PLUGIN_EXECUTION_FAILED },
          true
        )
        logger.error('检查bypass插件错误')
        logger.error(error)
      }
    }

    return false
  }

  extractMessageText(e) {
    if (e.raw_message) return this.dealText(e.raw_message)

    const messages = Array.isArray(e.message) ? e.message : (e.message ? [e.message] : [])
    const text = messages
      .filter(msg => msg.type === 'text')
      .map(msg => msg.text || '')
      .join('')

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
    if (!Array.isArray(ruleList)) ruleList = [ruleList].filter(Boolean)

    return ruleList.map(rule => {
      const cloned = { ...rule }
      if (cloned.reg) cloned.reg = this.createRegExp(cloned.reg)
      return cloned
    })
  }

  applyRuleTemplates(plugin, templates = []) {
    if (!templates.length) return
    plugin.rule = templates.map(t => ({ ...t, reg: t.reg }))
  }

  collectBypassRules(ruleTemplates = []) {
    return ruleTemplates
      .filter(rule => rule?.reg)
      .map(rule => ({ reg: rule.reg }))
  }

  async importPlugin(file, packageErr) {
    try {
      let app = await import(file.path)
      app = app.apps ? { ...app.apps } : app

      const imports = []
      for (const [key, value] of Object.entries(app)) {
        imports.push(this.loadPlugin(file, value))
      }
      await Promise.allSettled(imports)
    } catch (error) {
      if (error.stack?.includes('Cannot find package')) {
        packageErr.push({ error, file })
      } else {
        logger.error(`加载插件错误: ${file.name}`)
        logger.error(error)
      }
    }
  }

  /**
   * 加载单个插件类
   * @param {Object} file - 文件信息
   * @param {Function} p - 插件类
   */
  async loadPlugin(file, p) {
    try {
      if (!p?.prototype) return

      this.pluginCount++
      const plugin = new p()

      logger.debug(`加载插件实例 [${file.name}][${plugin.name}]`)

      if (plugin.init) {
        const initRes = await Promise.race([
          plugin.init(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('init_timeout')), 5000))
        ]).catch(err => {
          logger.error(`插件 ${plugin.name} 初始化错误: ${err.message}`)
          return 'return'
        })

        if (initRes === 'return') return
      }

      if (plugin.task) {
        const tasks = Array.isArray(plugin.task) ? plugin.task : [plugin.task]
        tasks.forEach(t => {
          if (t?.cron && t.fnc) {
            this.task.push({
              name: t.name || plugin.name,
              cron: t.cron,
              fnc: t.fnc,
              log: t.log !== false
            })
          }
        })
      }

      const ruleTemplates = this.prepareRuleTemplates(plugin.rule || [])
      this.applyRuleTemplates(plugin, ruleTemplates)

      const pluginData = {
        class: p,
        key: file.name,
        name: plugin.name,
        priority: plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50),
        plugin,
        bypassThrottle: plugin.bypassThrottle === true,
        taskers: this.buildAdapterSet(plugin),
        ruleTemplates,
        bypassRules: this.collectBypassRules(ruleTemplates)
      }

      const targetArray = plugin.priority === 'extended' ? this.extended : this.priority
      targetArray.push(pluginData)

      if (plugin.handler) {
        Object.values(plugin.handler).forEach(handler => {
          if (!handler) return
          const { fn, key, priority } = handler
          Handler.add({
            ns: plugin.namespace || file.name,
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
            this.subscribeEvent(eventType, handler.bind(plugin))
          }
        })
      }
    } catch (error) {
      logger.error(`加载插件 ${file.name} 失败`)
      logger.error(error)
    }
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
      const matches = error.stack?.match(/'(.+?)'/g)
      const pack = matches?.[0]?.replace(/'/g, '') || '未知依赖'
      logger.warning(`${file.name} 缺少依赖: ${pack}`)
    })
    logger.error(`安装插件后请 pnpm i 安装依赖`)
    logger.error('--------------------------------')
  }

  sortPlugins() {
    this.priority = lodash.orderBy(this.priority, ['priority'], ['asc'])
    this.extended = lodash.orderBy(this.extended, ['priority'], ['asc'])
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
    if (tasker) {
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
    
    for (const actualEvent of possibleEvents) {
      if (pluginEvent === actualEvent || this.matchEventPattern(pluginEvent, actualEvent)) {
        return true
      }
    }
    
    if (!pluginEvent.includes('.')) {
      return genericEvents.includes(pluginEvent)
    }
    
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

    // 特定 tasker 的限制检查（如群禁言等）由 tasker 增强插件处理
    // 这里只做通用的冷却检查

    if (!e.message || !e.group_id || ['cmd'].includes(e.tasker)) {
      return true
    }

    const config = cfg.getGroup(e.group_id) || {}
    const groupCD = config.groupGlobalCD || 0
    const singleCD = config.singleCD || 0
    const deviceCD = config.deviceCD || 0

    if ((groupCD && this.cooldowns.group.has(e.group_id)) ||
      (singleCD && this.cooldowns.single.has(`${e.group_id}.${e.user_id}`)) ||
      (e.device_id && deviceCD && this.cooldowns.device.has(e.device_id))) {
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
    if (e.isDevice) return

    const tasker = e.tasker || ''
    if (!e.message || !e.group_id || ['cmd'].includes(tasker)) return

    const groupConfig = cfg.getGroup(e.group_id) || {}
    const otherConfig = cfg.getOther() || {}
    const config = Object.keys(groupConfig).length > 0 ? groupConfig : otherConfig

    const setCooldown = (type, key, time) => {
      if (time > 0) {
        this.cooldowns[type].set(key, Date.now())
        setTimeout(() => this.cooldowns[type].delete(key), time)
      }
    }

    if (e.group_id) {
      setCooldown('group', e.group_id, config.groupGlobalCD || 0)
      setCooldown('single', `${e.group_id}.${e.user_id}`, config.singleCD || 0)
    }
  }


  checkDisable(p) {
    if (!p) return false
    if (!p.e) return true

    if (p.e.isDevice) {
      const other = cfg.getOther()
      if (!other) return true

      const { disableDevice = [], enableDevice = [] } = other
      if (Array.isArray(disableDevice) && disableDevice.includes(p.name)) return false
      if (Array.isArray(enableDevice) && enableDevice.length > 0 && !enableDevice.includes(p.name)) return false
      return true
    }

    if (!p.e.group_id) return true

    const groupCfg = cfg.getGroup(p.e.group_id)
    if (!groupCfg) return true

    const { disable = [], enable = [] } = groupCfg
    if (Array.isArray(disable) && disable.includes(p.name)) return false
    if (Array.isArray(enable) && enable.length > 0 && !enable.includes(p.name)) return false

    return true
  }

  createRegExp(pattern) {
    if (!pattern && pattern !== '') return false
    if (pattern instanceof RegExp) return pattern
    if (typeof pattern !== 'string') return false
    if (pattern === 'null' || pattern === '') return /.*/

    try {
      return new RegExp(pattern)
    } catch (e) {
      logger.error(`正则表达式创建失败: ${pattern}`)
      logger.error(e)
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
    if (cfg.bot?.['/→#']) text = text.replace(/^\s*\/\s*/, '#')
    return text
      .replace(/^\s*[＃井#]+\s*/, '#')
      .replace(/^\s*[\\*※＊]+\s*/, '*')
      .trim()
  }

  initEventSystem() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    this.cleanupTimer = setInterval(() => {
      try {
        // 统一清理逻辑：使用智能缓存自动管理
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
    
    // 清理事件节流
    for (const [key, time] of this.eventThrottle) {
      if (now - time > 60000) {
        this.eventThrottle.delete(key)
      }
    }

    // 清理消息节流
    for (const [key, time] of this.msgThrottle) {
      if (now - time > 5000) {
        this.msgThrottle.delete(key)
      }
    }
  }

  /**
   * 统一的冷却清理
   */
  cleanupCooldowns() {
    const now = Date.now()
    for (const cooldownType of ['group', 'single', 'device']) {
      for (const [key, time] of this.cooldowns[cooldownType]) {
        if (now - time > 300000) {
          this.cooldowns[cooldownType].delete(key)
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
      if (!subscribers) return
      const index = subscribers.indexOf(callback)
      if (index > -1) {
        subscribers.splice(index, 1)
      }
    }
  }

  createTask() {
    const created = new Set()

    for (const task of this.task) {
      if (task.job) {
        task.job.cancel()
      }

      const name = `[${task.name}][${task.cron}]`

      if (created.has(name)) {
        logger.warn(`重复定时任务 ${name} 已跳过`)
        continue
      }

      created.add(name)
      logger.debug(`加载定时任务 ${name}`)

      const cronParts = task.cron.split(/\s+/)
      const cronExp = cronParts.slice(0, 6).join(' ')

      task.job = schedule.scheduleJob(cronExp, async () => {
        try {
          const start = Date.now()
          if (task.log) logger.mark(`${name} 开始执行`)

          await task.fnc()

          if (task.log) logger.mark(`${name} 执行完成 ${Date.now() - start}ms`)
        } catch (err) {
          logger.error(`定时任务 ${name} 执行失败`)
          logger.error(err)
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

      if (Array.isArray(msg)) {
        msg.forEach(checkImg)
      } else {
        checkImg(msg)
      }

      if (type === 'send') {
        this.saveCount('sendMsg', e.group_id)
      }
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

  async changePlugin(key) {
    try {
      // 查找插件文件路径
      const { FileLoader } = await import('#utils/file-loader.js');
      const pluginDirs = await FileLoader.getCoreSubDirs('plugin');
      let pluginPath = null;
      
      for (const pluginDir of pluginDirs) {
        const filePath = path.join(pluginDir, `${key}.js`);
        if (existsSync(filePath)) {
          pluginPath = filePath;
          break;
        }
      }
      
      if (!pluginPath) {
        logger.error(`插件文件未找到: ${key}`);
        return;
      }
      
      const timestamp = moment().format('x');
      const relativePath = path.relative(paths.root, pluginPath);
      let app = await import(`../../../${relativePath.replace(/\\/g, '/')}?${timestamp}`);
      app = app.apps ? { ...app.apps } : app;

      Object.values(app).forEach(p => {
        if (!p?.prototype) return;
        const plugin = new p();
        const ruleTemplates = this.prepareRuleTemplates(plugin.rule || []);
        this.applyRuleTemplates(plugin, ruleTemplates);
        const priority = plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50);
        const targetArray = plugin.priority === 'extended' ? this.extended : this.priority;
        const index = targetArray.findIndex(item => item.key === key && item.name === plugin.name);
        if (index === -1) return;
        targetArray[index] = {
          ...targetArray[index],
          class: p,
          plugin,
          priority,
          bypassThrottle: plugin.bypassThrottle === true,
          taskers: this.buildAdapterSet(plugin),
          ruleTemplates,
          bypassRules: this.collectBypassRules(ruleTemplates)
        };
      });

      this.sortPlugins()
      this.identifyDefaultMsgHandlers()
      logger.mark(`[热更新插件][${key}]`)
    } catch (error) {
      logger.error(`热更新插件错误: ${key}`)
      logger.error(error)
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
      const pluginDirs = await paths.getCoreSubDirs('plugin');
      
      if (pluginDirs.length === 0) {
        logger.debug('未找到 plugin 目录，跳过文件监视');
        return;
      }
      
      const watcher = chokidar.watch(pluginDirs, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      const handleFileChange = async (filePath, eventType) => {
        try {
          const fileName = path.basename(filePath);
          if (!fileName.endsWith('.js') || fileName.startsWith('.') || fileName.startsWith('_')) return;

          const key = fileName;
          
          if (eventType === 'add') {
            logger.mark(`[新增插件][${key}]`);
            const relativePath = path.relative(paths.root, filePath);
            await this.importPlugin({
              name: key,
              path: `../../../${relativePath.replace(/\\/g, '/')}?${moment().format('X')}`
            }, []);
            this.sortPlugins();
            this.identifyDefaultMsgHandlers();
          } else if (eventType === 'change') {
            logger.mark(`[修改插件][${key}]`);
            await this.changePlugin(key);
          } else if (eventType === 'unlink') {
            logger.mark(`[删除插件][${key}]`);
            this.priority = this.priority.filter(p => p.key !== key);
            this.extended = this.extended.filter(p => p.key !== key);
            this.identifyDefaultMsgHandlers();
          }
        } catch (error) {
          logger.error(`处理插件${eventType}失败: ${error.message}`);
        }
      };

      watcher
        .on('add', lodash.debounce((filePath) => handleFileChange(filePath, 'add'), 500))
        .on('change', lodash.debounce((filePath) => handleFileChange(filePath, 'change'), 500))
        .on('unlink', lodash.debounce((filePath) => handleFileChange(filePath, 'unlink'), 500))
        .on('error', (error) => {
          logger.error('插件文件监视错误', error);
        });

      this.watcher.dir = watcher;
      logger.debug('插件文件监视已启动');
    } catch (error) {
      logger.error('启动插件文件监视失败', error);
    }
  }


  async emit(eventType, eventData) {
    try {
      const eventTypeParts = eventType.split('.')
      const postType = eventTypeParts[0] || 'custom'
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
      logger.error('触发自定义事件失败')
      logger.error(error)
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
      
      if (memoryUsage > 0.8) return 5  // 内存紧张时减小批次
      if (memoryUsage > 0.6) return 8
      return 10  // 默认批次
    } catch (error) {
      // debug: 获取内存信息失败不影响加载
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
        // warn: 性能问题需要关注
        logger.warn(`发现 ${slowPlugins.length} 个加载较慢的插件:`)
        slowPlugins.slice(0, 5).forEach(p => {
          logger.warn(`  - ${p.name}: ${p.loadTime}ms`)
        })
      }
      
      // debug: 性能统计是技术细节
      const avgLoadTime = this.pluginLoadStats.plugins.length > 0
        ? this.pluginLoadStats.plugins.reduce((sum, p) => sum + p.loadTime, 0) / this.pluginLoadStats.plugins.length
        : 0
      logger.debug(`平均插件加载时间: ${avgLoadTime.toFixed(2)}ms`)
    } catch (error) {
      // debug: 性能分析失败不影响加载
      logger.debug(`性能分析失败: ${error.message}`)
    }
  }

  async destroy() {
    try {
      for (const task of this.task) {
        if (task.job) task.job.cancel()
      }

      for (const watcher of Object.values(this.watcher)) {
        if (watcher && typeof watcher.close === 'function') {
          await watcher.close()
        }
      }

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
      this.cooldowns.device.clear()
      this.msgThrottle.clear()
      this.eventThrottle.clear()
      this.eventSubscribers.clear()
      this.eventHistory = []

      logger.info('插件加载器已销毁')
    } catch (error) {
      errorHandler.handle(
        error,
        { context: 'destroy', code: ErrorCodes.SYSTEM_ERROR },
        true
      )
      logger.error('销毁插件加载器失败')
      logger.error(error)
    }
  }

}

export default new PluginsLoader()