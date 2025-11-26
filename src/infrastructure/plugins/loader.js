import fs from 'fs/promises'
import { pathToFileURL } from 'url'
import paths from '#utils/paths.js'
import { existsSync } from 'fs'
import path from 'path'
import lodash from 'lodash'
import cfg from '#infrastructure/config/config.js'
import plugin, { PluginSchema } from './plugin.js'
import schedule from 'node-schedule'
import chokidar from 'chokidar'
import moment from 'moment'
import Handler from './handler.js'
import Runtime from './runtime.js'
import { segment } from '#oicq'
import BotUtil from '#utils/botutil.js'
import LimitManager from './managers/LimitManager.js'
import MessageHandler from './managers/MessageHandler.js'
import PluginExecutor from './managers/PluginExecutor.js'

global.plugin = plugin
global.segment = segment

/**
 * 事件类型映射表
 * 用于将事件字符串转换为对应的属性路径
 */
const EVENT_MAP = {
  message: ['post_type', 'message_type', 'sub_type'],
  notice: ['post_type', 'notice_type', 'sub_type'],
  request: ['post_type', 'request_type', 'sub_type'],
  device: ['post_type', 'event_type', 'sub_type']
}

/**
 * 插件加载器类
 * 负责加载、管理和执行插件
 */
class PluginsLoader {
  constructor() {
    this.priority = []              // 普通优先级插件列表
    this.extended = []              // 扩展插件列表
    this.task = []                  // 定时任务列表
    this.dir = 'core/plugin'            // 插件目录（项目根目录下，可不存在）
    this.watcher = {}               // 文件监听器

    this.defaultMsgHandlers = []    // 默认消息处理器
    this.eventSubscribers = new Map() // 事件订阅者
    this.pluginCount = 0            // 插件计数
    this.eventHistory = []          // 事件历史
    this.MAX_EVENT_HISTORY = 1000   // 最大事件历史记录数
    this.cleanupTimer = null        // 清理定时器
    this.pluginLoadStats = this.initLoadStats()
  }

  initLoadStats() {
    return {
      plugins: [],
      totalLoadTime: 0,
      startTime: 0,
      totalPlugins: 0,
      taskCount: 0,
      extendedCount: 0
    }
  }

  /**
   * 加载所有插件
   */
  async load(isRefresh = false) {
    try {
      if (!isRefresh && this.priority.length) return

      await this.prepareForLoad()

      BotUtil.makeLog('info', '开始加载插件...', 'PluginsLoader')

      const files = await this.getPlugins()
      if (!files.length) {
        this.finalizeLoad([])
        return
      }

      const packageErr = []
      await this.loadFilesInBatches(files, packageErr)

      this.finalizeLoad(packageErr)
    } catch (error) {
      BotUtil.makeLog('error', '插件加载器初始化失败', 'PluginsLoader', error)
      throw error
    }
  }

  async prepareForLoad() {
    this.pluginLoadStats = this.initLoadStats()
    this.pluginLoadStats.startTime = Date.now()

    this.priority = []
    this.extended = []
    this.task = []
    this.pluginCount = 0
    await this.delCount()
  }

  finalizeLoad(packageErr) {
    this.pluginLoadStats.totalLoadTime = Date.now() - this.pluginLoadStats.startTime
    this.pluginLoadStats.totalPlugins = this.pluginCount
    this.pluginLoadStats.taskCount = this.task.length
    this.pluginLoadStats.extendedCount = this.extended.length

    this.packageTips(packageErr)
    this.createTask()
    this.initEventSystem()
    this.sortPlugins()
    this.identifyDefaultMsgHandlers()

    const totalTime = (this.pluginLoadStats.totalLoadTime / 1000).toFixed(4)
    BotUtil.makeLog('info', `插件加载完成: 插件${this.pluginCount}个, 定时任务${this.task.length}个, 扩展插件${this.extended.length}个, 耗时${totalTime}秒`, 'PluginsLoader')
  }

  async loadFilesInBatches(files, packageErr) {
    const batches = lodash.chunk(files, 10)
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(file => this.loadSingleFile(file, packageErr))
      )
    }
  }

  async loadSingleFile(file, packageErr) {
    const startTime = Date.now()
    try {
      await this.importPlugin(file, packageErr)
      this.recordPluginStat(file.name, startTime, true)
    } catch (error) {
      this.recordPluginStat(file.name, startTime, false, error)
    }
  }

  recordPluginStat(name, startTime, success, error) {
    const loadTime = Date.now() - startTime
    this.pluginLoadStats.plugins.push({
      name,
      loadTime,
      success,
      error: error?.message
    })

    if (success) {
      BotUtil.makeLog('debug', `加载插件: ${name} (${loadTime}ms)`, 'PluginsLoader')
    } else if (error) {
      BotUtil.makeLog('error', `插件加载失败: ${name} - ${error.message}`, 'PluginsLoader', error)
    }
  }

  /**
   * 处理事件
   * @param {Object} e - 事件对象
   */
  async deal(e) {
    try {
      if (!e) return

      // 初始化事件
      this.initEvent(e)

      if (this.isSpecialEvent(e)) {
        return await this.dealSpecialEvent(e)
      }

      const hasBypassPlugin = this.priority.some(p => p.bypassThrottle === true);
      const shouldContinue = await this.preCheck(e, hasBypassPlugin)
      if (!shouldContinue) return

      // 处理消息
      await MessageHandler.dealMsg(e);
      this.addUtilMethods(e);
      this.setupReply(e);
      await Runtime.init(e)

      const context = {
        priority: this.priority,
        extended: this.extended,
        defaultMsgHandlers: this.defaultMsgHandlers,
        parseMessage: MessageHandler.dealMsg.bind(MessageHandler)
      };

      await PluginExecutor.runPlugins(e, context, true);

      if (!e.isDevice && !e.isStdin) {
        if (!this.onlyReplyAt(e)) return;
        const shouldSetLimit = !this.priority.some(p => p.bypassThrottle === true);
        if (shouldSetLimit) this.setLimit(e);
      }

      const handled = await PluginExecutor.runPlugins(e, context, false);

      if (!handled) {
        logger.debug(`${e.logText} 暂无插件处理`)
      }
    } catch (error) {
      logger.error('处理事件错误')
      logger.error(error)
    }
  }



  /**
   * 设置回复方法
   * @param {Object} e - 事件对象
   */
  setupReply(e) {
    if (!e.reply || e.isDevice) return

    e.replyNew = e.reply

    e.reply = async (msg = '', quote = false, data = {}) => {
      if (!msg) return false

      try {
        // stdin事件直接回复
        if (e.isStdin) {
          return await e.replyNew(msg, quote, data)
        }

        // 检查群聊禁言
        if (e.isGroup && e.group) {
          if (e.group.mute_left > 0 ||
            (e.group.all_muted && !e.group.is_admin && !e.group.is_owner)) {
            return false
          }
        }

        let { recallMsg = 0, at = '' } = data
        if (!Array.isArray(msg)) msg = [msg]

        // 处理@
        if (at && e.isGroup) {
          const atId = at === true ? e.user_id : at
          const atName = at === true ? e.sender?.card : ''
          msg.unshift(segment.at(atId, lodash.truncate(atName, { length: 10 })), '\n')
        }

        // 处理引用
        if (quote && e.message_id) {
          msg.unshift(segment.reply(e.message_id))
        }

        // 发送消息
        let msgRes
        try {
          msgRes = await e.replyNew(msg, false)
        } catch (err) {
          logger.error(`发送消息错误: ${err.message}`)
          // 尝试发送纯文本
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

        // 处理撤回
        if (!e.isGuild && recallMsg > 0 && msgRes?.message_id) {
          const target = e.isGroup ? e.group : e.friend
          if (target?.recallMsg) {
            setTimeout(() => {
              target.recallMsg(msgRes.message_id)
              if (e.message_id) target.recallMsg(e.message_id)
            }, recallMsg * 1000)
          }
        }

        this.count(e, 'send', msg)
        return msgRes
      } catch (error) {
        logger.error('回复消息处理错误')
        logger.error(error)
        return { error: error.message }
      }
    }
  }



  /**
   * 判断是否为特殊事件
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  isSpecialEvent(e) {
    return this.isStdinEvent(e) || this.isDeviceEvent(e)
  }

  /**
   * 判断是否为stdin事件
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  isStdinEvent(e) {
    return e.adapter === 'api' || e.adapter === 'stdin' || e.source === 'api'
  }

  /**
   * 判断是否为设备事件
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  isDeviceEvent(e) {
    return e.post_type === 'device' || e.adapter === 'device' ||
      e.isDevice || !!e.device_id ||
      (e.event_type && Bot[e.self_id])
  }

  /**
   * 处理特殊事件
   * @param {Object} e - 事件对象
   * @returns {Promise}
   */
  async dealSpecialEvent(e) {
    if (this.isStdinEvent(e)) {
      return await this.dealStdinEvent(e)
    }
    if (this.isDeviceEvent(e)) {
      return await this.dealDeviceEvent(e)
    }
  }

  /**
   * 处理stdin事件
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
  async dealStdinEvent(e) {
    try {
      e.isStdin = true
      e.logText = `[${e.adapter === 'api' ? 'API' : 'STDIN'}][${e.user_id || '未知'}]`

      // 设置API响应方法
      if (e.adapter === 'api' && !e.respond) {
        e.respond = async (data) => {
          if (e._apiResponse && Array.isArray(e._apiResponse)) {
            e._apiResponse.push(data)
          }
          return data
        }
      }

      // 处理消息
      if (e.message) {
        await MessageHandler.dealMsg(e);
        this.addUtilMethods(e);
      }
      this.setupReply(e);

      // 运行插件
      const context = {
        priority: this.priority,
        extended: this.extended,
        defaultMsgHandlers: this.defaultMsgHandlers,
        parseMessage: MessageHandler.dealMsg.bind(MessageHandler)
      };
      await PluginExecutor.runPlugins(e, context, true);
      const handled = await PluginExecutor.runPlugins(e, context, false);

      if (!handled) {
        logger.debug(`${e.logText} 暂无插件处理`)
      }

      return true
    } catch (error) {
      logger.error(`处理${e.adapter}事件错误`)
      logger.error(error)
      return false
    }
  }

  /**
   * 处理设备事件
   * @param {Object} e - 事件对象
   * @returns {Promise}
   */
  async dealDeviceEvent(e) {
    try {
      e.isDevice = true
      e.logText = `[设备][${e.device_name || e.device_id}][${e.event_type || '未知事件'}]`

      // 处理设备消息
      if (e.event_type === 'message' || e.event_data?.message) {
        e.message = e.event_data.message;
        e.raw_message = typeof e.message === 'string' ? e.message : JSON.stringify(e.message);
        e.msg = e.raw_message;
        await MessageHandler.dealMsg(e);
        this.addUtilMethods(e);
      }

      // 运行插件
      const context = {
        priority: this.priority,
        extended: this.extended,
        defaultMsgHandlers: this.defaultMsgHandlers,
        parseMessage: MessageHandler.dealMsg.bind(MessageHandler)
      };
      await PluginExecutor.runPlugins(e, context, true);
      const handled = await PluginExecutor.runPlugins(e, context, false);

      if (!handled) {
        logger.debug(`${e.logText} 设备事件暂无插件处理`)
      }
    } catch (error) {
      logger.error('处理设备事件错误')
      logger.error(error)
    }
  }

  /**
   * 初始化事件
   * @param {Object} e - 事件对象
   */
  initEvent(e) {
    // 设置self_id
    if (!e.self_id) {
      if (e.device_id) {
        e.self_id = e.device_id
      } else if (this.isStdinEvent(e)) {
        e.self_id = 'stdin'
      } else if (Bot.uin?.length > 0) {
        e.self_id = Bot.uin[0]
      }
    }

    // 设置bot实例
    const bot = this.isStdinEvent(e) ? (Bot.stdin || Bot) :
      e.device_id && Bot[e.device_id] ? Bot[e.device_id] :
        e.self_id && Bot[e.self_id] ? Bot[e.self_id] : Bot

    // 使用不可修改的bot属性
    Object.defineProperty(e, 'bot', {
      value: bot,
      writable: false,
      configurable: false
    })

    // 生成事件ID
    if (!e.event_id) {
      const postType = e.post_type || 'unknown'
      const randomId = Math.random().toString(36).substr(2, 9)
      e.event_id = `${postType}_${Date.now()}_${randomId}`
    }

    this.count(e, 'receive')
  }

  /**
   * 前置检查
   * 检查机器人状态、权限和限制
   * @param {Object} e - 事件对象
   * @param {boolean} hasBypassPlugin - 是否有绕过节流的插件
   * @returns {Promise<boolean>} 是否继续处理
   */
  async preCheck(e, hasBypassPlugin = false) {
    try {
      // 特殊事件（设备、标准输入）直接通过
      if (e.isDevice || e.isStdin) return true

      // 检查是否忽略自己的消息
      const botUin = e.self_id || Bot.uin?.[0]
      if (cfg.bot?.ignore_self !== false && e.user_id === botUin) {
        return false
      }

      // 获取原始消息内容并处理
      let msg = e.raw_message || ''
      if (!msg && e.message) {
        // 如果没有raw_message，从message数组中提取文本
        if (Array.isArray(e.message)) {
          msg = e.message
            .filter(m => m.type === 'text')
            .map(m => m.text || '')
            .join('')
        } else {
          msg = e.message.toString()
        }
      }

      // 处理消息前缀（将斜杠转换为#等）
      msg = MessageHandler.dealText(msg)
      const isStartCommand = /^#开机$/.test(msg)
      if (isStartCommand) {
        // 检查主人权限
        const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || []
        const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]
        const isMaster = masters.some(id => String(e.user_id) === String(id))

        if (isMaster) {
          // 主人的开机命令直接通过，不检查关机状态
          return true
        }
      }

      // 检查关机状态 - 使用异步获取
      const shutdownStatus = await redis.get(`Yz:shutdown:${botUin}`)
      if (shutdownStatus === 'true') {
        logger.debug(`[关机状态] 忽略消息: ${msg}`)
        return false
      }

      // 基础检查
      if (this.checkGuildMsg(e)) return false
      if (!this.checkBlack(e)) return false

      // bypass插件跳过限制检查
      if (hasBypassPlugin) return true

      // 检查消息限制
      return this.checkLimit(e)
    } catch (error) {
      logger.error('前置检查错误')
      logger.error(error)
      return false
    }
  }



  /**
   * 添加工具方法
   * @param {Object} e - 事件对象
   */
  addUtilMethods(e) {
    // 获取可发送的媒体文件
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

    // 节流控制
    e.throttle = (key, duration = 1000) => {
      return LimitManager.throttle(e, key, duration);
    }

    // 获取事件历史
    e.getEventHistory = (filter = {}) => {
      let history = [...this.eventHistory]

      if (filter.event_type) {
        history = history.filter(h => h.event_type === filter.event_type)
      }
      if (filter.user_id) {
        history = history.filter(h => h.event_data?.user_id === filter.user_id)
      }
      if (filter.device_id) {
        history = history.filter(h => h.event_data?.device_id === filter.device_id)
      }
      if (filter.limit && typeof filter.limit === 'number') {
        history = history.slice(0, filter.limit)
      }

      return history
    }
  }

  /**
   * 获取插件文件列表
   * @returns {Promise<Array>}
   */
  async getPlugins() {
    try {
      // 计算插件根目录绝对路径
      const pluginRoot = path.join(process.cwd(), this.dir)
      // 检查插件目录是否存在
      try {
        await fs.access(pluginRoot)
      } catch {
        BotUtil.makeLog('warn', `插件目录不存在: ${pluginRoot}，跳过加载`, 'PluginsLoader')
        return []
      }

      const entries = await fs.readdir(pluginRoot, { withFileTypes: true })
      const ret = []
      
      // 需要过滤的文件夹列表
      const excludedFolders = ['stream', 'events', 'adapter', 'api']

      for (const dir of entries) {
        if (!dir.isDirectory()) continue
        if (excludedFolders.includes(dir.name)) continue
        
        const dirPath = path.join(pluginRoot, dir.name)

        // 检查是否有index.js
        const indexJs = path.join(dirPath, 'index.js')
        if (existsSync(indexJs)) {
          ret.push({
            name: dir.name,
            path: pathToFileURL(indexJs).href
          })
          continue
        }

        // 扫描目录下的js文件
        const apps = await fs.readdir(dirPath, { withFileTypes: true })
        for (const app of apps) {
          if (!app.isFile() || !app.name.endsWith('.js')) continue
          const key = `${dir.name}/${app.name}`
          const absApp = path.join(dirPath, app.name)
          ret.push({
            name: key,
            path: pathToFileURL(absApp).href
          })
          this.watch(dir.name, app.name)
        }
      }
      return ret
    } catch (error) {
      BotUtil.makeLog('error', '获取插件文件列表失败', 'PluginsLoader', error)
      throw error
    }
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

  /**
   * 导入插件
   * @param {Object} file - 文件信息
   * @param {Array} packageErr - 包错误列表
   */
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
      }
      throw error
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

      const plugin = this.createPluginInstance(p, file.name)
      if (!plugin) return

      logger.debug(`加载插件实例 [${file.name}][${plugin.name}]`)

      const initialized = await this.initializePlugin(plugin)
      if (!initialized) return

      this.pluginCount++

      const descriptor = this.getPluginDescriptor(plugin)
      const compiledRules = this.compileRules(descriptor.rule, plugin.name)

      this.registerTasks(descriptor.tasks, plugin)

      const pluginData = this.buildPluginData(descriptor, compiledRules, p, file.name, plugin)
      this.addPluginToPool(pluginData, descriptor.priority === 'extended')

      this.registerHandlers(descriptor.handlers, plugin, file)
      this.registerEventSubscribers(descriptor.eventSubscribe, plugin)
    } catch (error) {
      logger.error(`加载插件 ${file.name} 失败`)
      logger.error(error)
    }
  }

  createPluginInstance(PluginClass, fileName) {
    try {
      return new PluginClass()
    } catch (error) {
      BotUtil.makeLog('error', `实例化插件失败: ${fileName}`, 'PluginsLoader', error)
      return null
    }
  }

  async initializePlugin(plugin) {
    if (typeof plugin.init !== 'function') return true

    try {
      await Promise.race([
        plugin.init(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('init_timeout')), 5000))
      ])
      return true
    } catch (err) {
      logger.error(`插件 ${plugin.name} 初始化错误: ${err.message}`)
      return false
    }
  }

  registerTasks(tasks, pluginInstance) {
    if (!Array.isArray(tasks) || !tasks.length) return

    tasks.forEach(task => {
      if (!task?.cron || !task.fnc) return
      const fn =
        typeof task.fnc === 'string'
          ? pluginInstance[task.fnc]?.bind(pluginInstance)
          : typeof task.fnc === 'function'
            ? task.fnc.bind(pluginInstance)
            : null

      if (!fn) return

      this.task.push({
        name: task.name || pluginInstance.name,
        cron: String(task.cron).trim(),
        fnc: fn,
        log: task.log !== false,
        timezone: task.timezone,
        immediate: task.immediate === true
      })
    })
  }

  buildPluginData(descriptor, rules, PluginClass, key, pluginInstance) {
    const numericPriority = typeof descriptor.priority === 'number'
      ? descriptor.priority
      : 50

    return {
      class: PluginClass,
      key,
      name: descriptor.name,
      dsc: descriptor.dsc,
      priority: numericPriority,
      execPriority: numericPriority,
      plugin: pluginInstance,
      rules: Array.isArray(rules) ? rules : [],
      bypassThrottle: descriptor.bypassThrottle === true,
      namespace: descriptor.namespace || key,
      extended: descriptor.priority === 'extended'
    }
  }

  getPluginDescriptor(pluginInstance) {
    const descriptor = typeof pluginInstance.getDescriptor === 'function'
      ? pluginInstance.getDescriptor()
      : {
        name: pluginInstance.name,
        dsc: pluginInstance.dsc,
        event: pluginInstance.event,
        priority: pluginInstance.priority,
        bypassThrottle: pluginInstance.bypassThrottle,
        namespace: pluginInstance.namespace || '',
        rule: pluginInstance.rule,
        tasks: pluginInstance.task,
        handlers: pluginInstance.handler,
        eventSubscribe: pluginInstance.eventSubscribe
      }

    return {
      name: descriptor.name || pluginInstance.name,
      dsc: descriptor.dsc || pluginInstance.dsc,
      event: descriptor.event || pluginInstance.event,
      priority: descriptor.priority ?? pluginInstance.priority,
      bypassThrottle: descriptor.bypassThrottle === true,
      namespace: descriptor.namespace || pluginInstance.namespace || '',
      rule: PluginSchema.normalizeRules(descriptor.rule),
      tasks: PluginSchema.normalizeTasks(descriptor.tasks ?? descriptor.task),
      handlers: PluginSchema.normalizeHandlers(descriptor.handlers ?? descriptor.handler),
      eventSubscribe: PluginSchema.normalizeEventSubscribe(descriptor.eventSubscribe)
    }
  }

  compileRules(rules, pluginName) {
    if (!Array.isArray(rules)) return []

    return rules.map((rule = {}, index) => {
      if (!rule) return null
      const compiled = PluginExecutor.createRegExp(rule.reg)
      const reg = compiled || /.*/

      return {
        ...rule,
        id: `${pluginName}:${index}`,
        reg,
        event: rule.event || 'message.*.*',
        log: rule.log !== false,
        permission: rule.permission || 'all'
      }
    }).filter(r => r !== null && r !== undefined)
  }

  addPluginToPool(pluginData, isExtended) {
    const targetArray = isExtended ? this.extended : this.priority
    targetArray.push(pluginData)
  }

  registerHandlers(handlers, pluginInstance, file) {
    if (!Array.isArray(handlers) || !handlers.length) return

    handlers.forEach(handler => {
      if (!handler?.key) return
      const fn =
        typeof handler.fnc === 'string'
          ? pluginInstance[handler.fnc]
          : handler.ref

      if (typeof fn !== 'function') return

      Handler.add({
        ns: pluginInstance.namespace || handler.namespace || file.name,
        key: handler.key,
        self: pluginInstance,
        priority: handler.priority ?? pluginInstance.priority,
        fn: fn.bind(pluginInstance)
      })
    })
  }

  registerEventSubscribers(subscribers, pluginInstance) {
    if (!Array.isArray(subscribers) || !subscribers.length) return

    subscribers.forEach(sub => {
      if (!sub?.eventType) return
      if (typeof sub.handler === 'function') {
        this.subscribeEvent(sub.eventType, sub.handler.bind(pluginInstance))
        return
      }
      if (typeof sub.fnc === 'string' && typeof pluginInstance[sub.fnc] === 'function') {
        this.subscribeEvent(sub.eventType, pluginInstance[sub.fnc].bind(pluginInstance))
      }
    })
  }

  /**
   * 识别默认消息处理器
   */
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

  /**
   * 显示依赖缺失提示
   * @param {Array} packageErr - 包错误列表
   */
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

  /**
   * 插件排序
   */
  sortPlugins() {
    this.priority = lodash.orderBy(this.priority, ['priority'], ['asc'])
    this.extended = lodash.orderBy(this.extended, ['priority'], ['asc'])
  }



  /**
   * 检查消息限制
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  checkLimit(e) {
    return LimitManager.checkLimit(e);
  }

  /**
   * 设置消息限制
   * @param {Object} e - 事件对象
   */
  setLimit(e) {
    LimitManager.setLimit(e);
  }

  /**
   * 检查是否仅回复@消息
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  onlyReplyAt(e) {
    // 特殊事件直接通过
    if (e.isDevice || e.isStdin) return true

    const adapter = e.adapter || ''
    if (!e.message || e.isPrivate || ['cmd'].includes(adapter)) {
      return true
    }

    const groupCfg = e.group_id ? cfg.getGroup(e.group_id) : {}
    const onlyReplyAt = groupCfg.onlyReplyAt ?? 0

    return onlyReplyAt === 0 || !groupCfg.botAlias ||
      (onlyReplyAt === 2 && e.isMaster) ||
      e.atBot || e.hasAlias
  }

  /**
   * 检查频道消息
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  checkGuildMsg(e) {
    const other = cfg.getOther()
    return other?.disableGuildMsg === true && e.detail_type === 'guild'
  }

  /**
   * 检查黑名单
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  checkBlack(e) {
    // 特殊事件直接通过
    if (e.isDevice || e.isStdin) return true

    const adapter = e.adapter || ''
    if (['cmd'].includes(adapter)) return true

    const other = cfg.getOther()
    if (!other) return true

    const check = id => [Number(id), String(id)]

    // QQ黑名单
    const blackQQ = other.blackQQ || []
    if (Array.isArray(blackQQ)) {
      if (check(e.user_id).some(id => blackQQ.includes(id))) return false
      if (e.at && check(e.at).some(id => blackQQ.includes(id))) return false
    }

    // 设备黑名单
    const blackDevice = other.blackDevice || []
    if (e.device_id && Array.isArray(blackDevice) && blackDevice.includes(e.device_id)) {
      return false
    }

    // QQ白名单
    const whiteQQ = other.whiteQQ || []
    if (Array.isArray(whiteQQ) && whiteQQ.length > 0 &&
      !check(e.user_id).some(id => whiteQQ.includes(id))) {
      return false
    }

    // 群组黑白名单
    if (e.group_id) {
      const blackGroup = other.blackGroup || []
      if (Array.isArray(blackGroup) && check(e.group_id).some(id => blackGroup.includes(id))) {
        return false
      }

      const whiteGroup = other.whiteGroup || []
      if (Array.isArray(whiteGroup) && whiteGroup.length > 0 &&
        !check(e.group_id).some(id => whiteGroup.includes(id))) {
        return false
      }
    }

    return true
  }







  /**
   * 初始化事件系统
   */
  initEventSystem() {
    // 清理旧的定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    // 定期清理事件历史
    this.cleanupTimer = setInterval(() => {
      try {
        // 清理事件历史
        if (this.eventHistory.length > this.MAX_EVENT_HISTORY) {
          this.eventHistory = this.eventHistory.slice(-this.MAX_EVENT_HISTORY)
        }
      } catch (error) {
        logger.error('事件历史清理定时器执行错误')
        logger.error(error)
      }
    }, 60000)

    this.registerGlobalEventListeners()
  }

  /**
   * 注册全局事件监听器
   */
  registerGlobalEventListeners() {
    const eventTypes = ['message', 'notice', 'request', 'device']

    eventTypes.forEach(type => {
      Bot.on(type, (e) => {
        try {
          this.recordEventHistory(type, e)
          this.distributeToSubscribers(type, e)
        } catch (error) {
          logger.error(`事件监听器错误 [${type}]`)
          logger.error(error)
        }
      })
    })
  }

  /**
   * 记录事件历史
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   */
  recordEventHistory(eventType, eventData) {
    const historyEntry = {
      event_id: eventData.event_id || Date.now().toString(),
      event_type: eventType,
      event_data: eventData,
      timestamp: Date.now(),
      source: eventData.adapter || eventData.device_id || 'internal'
    }

    this.eventHistory.unshift(historyEntry)

    // 立即清理超出限制的历史记录
    if (this.eventHistory.length > this.MAX_EVENT_HISTORY * 1.5) {
      this.eventHistory = this.eventHistory.slice(0, this.MAX_EVENT_HISTORY)
    }
  }

  /**
   * 分发事件给订阅者
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   */
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

  /**
   * 订阅事件
   * @param {string} eventType - 事件类型
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  subscribeEvent(eventType, callback) {
    if (!this.eventSubscribers.has(eventType)) {
      this.eventSubscribers.set(eventType, [])
    }

    this.eventSubscribers.get(eventType).push(callback)

    // 返回取消订阅函数
    return () => {
      const subscribers = this.eventSubscribers.get(eventType)
      if (!subscribers) return
      const index = subscribers.indexOf(callback)
      if (index > -1) {
        subscribers.splice(index, 1)
      }
    }
  }

  /**
   * 创建定时任务
   */
  createTask() {
    const created = new Set()

    for (const task of this.task) {
      // 取消已存在的任务
      if (task.job) {
        task.job.cancel()
      }

      const name = `[${task.name}][${task.cron}]`

      // 检查重复任务
      if (created.has(name)) {
        logger.warn(`重复定时任务 ${name} 已跳过`)
        continue
      }

      created.add(name)
      logger.debug(`加载定时任务 ${name}`)

      // 创建定时任务
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

  /**
   * 统计计数
   * @param {Object} e - 事件对象
   * @param {string} type - 统计类型
   * @param {any} msg - 消息内容
   */
  async count(e, type, msg) {
    if (e.isDevice || e.isStdin) return

    try {
      // 检查图片
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

  /**
   * 保存计数
   * @param {string} type - 计数类型
   * @param {string} groupId - 群组ID
   */
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
   * 热更新插件
   * @param {string} key - 插件键
   */
  async changePlugin(key) {
    try {
      const timestamp = moment().format('x')
      const absPath = path.join(process.cwd(), this.dir, key)
      let app = await import(`${pathToFileURL(absPath).href}?${timestamp}`)
      app = app.apps ? { ...app.apps } : app

      Object.values(app).forEach(p => {
        if (!p?.prototype) return

        const plugin = new p()

        // 编译规则正则
        if (plugin.rule) {
          plugin.rule.forEach(rule => {
            if (rule.reg) rule.reg = PluginExecutor.createRegExp(rule.reg)
          })
        }

        // 更新插件
        const update = (arr) => {
          const index = arr.findIndex(item =>
            item.key === key && item.name === plugin.name
          )

          if (index !== -1) {
            const priority = plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50)

            arr[index] = {
              ...arr[index],
              class: p,
              plugin,
              priority,
              bypassThrottle: plugin.bypassThrottle === true
            }
          }
        }

        // 更新对应的插件列表
        if (plugin.priority === 'extended') {
          update(this.extended)
        } else {
          update(this.priority)
        }
      })

      this.sortPlugins()
      this.identifyDefaultMsgHandlers() // 重新识别默认处理器
      logger.mark(`[热更新插件][${key}]`)
    } catch (error) {
      logger.error(`热更新插件错误: ${key}`)
      logger.error(error)
    }
  }

  /**
   * 监听插件文件变化
   * @param {string} dirName - 目录名
   * @param {string} appName - 应用名
   */
  watch(dirName, appName) {
    const watchKey = `${dirName}.${appName}`
    if (this.watcher[watchKey]) return

    const file = `./${this.dir}/${dirName}/${appName}`

    try {
      const watcher = chokidar.watch(file, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      })

      const key = `${dirName}/${appName}`

      // 监听文件变化
      watcher.on('change', lodash.debounce(() => {
        logger.mark(`[修改插件][${dirName}][${appName}]`)
        this.changePlugin(key)
      }, 500))

      watcher.on('error', error => {
        logger.error(`文件监听错误 [${watchKey}]`)
        logger.error(error)
      })

      this.watcher[watchKey] = watcher
      this.watchDir(dirName)
    } catch (error) {
      logger.error(`设置文件监听失败 [${watchKey}]`)
      logger.error(error)
    }
  }

  /**
   * 监听插件目录
   * @param {string} dirName - 目录名
   */
  watchDir(dirName) {
    if (this.watcher[dirName]) return

    try {
      const watcher = chokidar.watch(`./${this.dir}/${dirName}/`, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      })

      setTimeout(() => {
        watcher.on('add', lodash.debounce(async (filePath) => {
          try {
            const appName = path.basename(filePath)
            if (!appName.endsWith('.js')) return

            const key = `${dirName}/${appName}`
            logger.mark(`[新增插件][${dirName}][${appName}]`)

            await this.importPlugin({
              name: key,
              path: `../../${this.dir}/${key}?${moment().format('X')}`
            }, [])

            this.sortPlugins()
            this.identifyDefaultMsgHandlers()
            this.watch(dirName, appName)
          } catch (error) {
            logger.error('处理新增插件失败')
            logger.error(error)
          }
        }, 500))

        watcher.on('unlink', lodash.debounce(async (filePath) => {
          try {
            const appName = path.basename(filePath)
            if (!appName.endsWith('.js')) return

            const key = `${dirName}/${appName}`
            const watchKey = `${dirName}.${appName}`

            logger.mark(`[删除插件][${dirName}][${appName}]`)

            // 移除插件
            this.priority = this.priority.filter(p => p.key !== key)
            this.extended = this.extended.filter(p => p.key !== key)
            this.identifyDefaultMsgHandlers()

            // 停止监听
            if (this.watcher[watchKey]) {
              this.watcher[watchKey].close()
              delete this.watcher[watchKey]
            }
          } catch (error) {
            logger.error('处理删除插件失败')
            logger.error(error)
          }
        }, 500))

        watcher.on('error', error => {
          logger.error(`目录监听错误 [${dirName}]`)
          logger.error(error)
        })
      }, 10000)

      this.watcher[dirName] = watcher
    } catch (error) {
      logger.error(`设置目录监听失败 [${dirName}]`)
      logger.error(error)
    }
  }

  /**
   * 触发自定义事件
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   * @returns {Object}
   */
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
   * 销毁加载器
   * 清理所有资源
   */
  async destroy() {
    try {
      // 清理定时任务
      for (const task of this.task) {
        if (task.job) task.job.cancel()
      }

      // 清理文件监听器
      for (const watcher of Object.values(this.watcher)) {
        if (watcher && typeof watcher.close === 'function') {
          await watcher.close()
        }
      }

      // 清理定时器
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer)
        this.cleanupTimer = null
      }

      // 销毁管理器
      LimitManager.destroy();

      // 清理内存
      this.priority = []
      this.extended = []
      this.task = []
      this.watcher = {}
      this.eventSubscribers.clear()
      this.eventHistory = []

      logger.info('插件加载器已销毁')
    } catch (error) {
      logger.error('销毁插件加载器失败')
      logger.error(error)
    }
  }
}

export default new PluginsLoader()