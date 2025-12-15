import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import lodash from 'lodash'
import cfg from '../config/config.js'
import plugin from './plugin.js'
import schedule from 'node-schedule'
import chokidar from 'chokidar'
import moment from 'moment'
import Handler from './handler.js'
import Runtime from './runtime.js'

global.plugin = plugin

class PluginsLoader {
  constructor() {
    this.priority = []
    this.extended = []
    this.task = []
    this.dir = 'core/plugin'
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
    this.eventHistory = []
    this.MAX_EVENT_HISTORY = 1000
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

      logger.info('-----------')
      logger.title('开始加载插件', 'yellow')

      const files = await this.getPlugins()
      this.pluginCount = 0
      const packageErr = []

      const batchSize = 10
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

              logger.error(`插件加载失败: ${file.name}`)
              logger.error(err)
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

      logger.success(`加载定时任务[${this.task.length}个]`)
      logger.success(`加载插件[${this.pluginCount}个]`)
      logger.success(`加载扩展插件[${this.extended.length}个]`)
      logger.success(`总加载耗时: ${(this.pluginLoadStats.totalLoadTime / 1000).toFixed(4)}秒`)
    } catch (error) {
      logger.error('插件加载器初始化失败')
      logger.error(error)
      throw error
    }
  }

  async deal(e) {
    try {
      if (!e) return

      this.initEvent(e)
      const hasBypassPlugin = await this.checkBypassPlugins(e)

      const shouldContinue = await this.preCheck(e, hasBypassPlugin)
      if (!shouldContinue) return

      await this.dealMsg(e)
      this.setupReply(e)
      await Runtime.init(e)

      await this.runPlugins(e, true)
      const handled = await this.runPlugins(e, false)

      if (!handled) {
        logger.debug(`${e.logText} 暂无插件处理`)
      }
    } catch (error) {
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

      // 处理别名（需要group_id）
      if (e.msg && e.group_id && !e.isDevice && !e.isStdin) {
        this.processAlias(e)
      }

      this.addUtilMethods(e)
    } catch (error) {
      logger.error('处理消息内容错误')
      logger.error(error)
    }
  }

  initMsgProps(e) {
    e.img = []
    e.video = []
    e.audio = []
    e.msg = ''
    e.message = Array.isArray(e.message) ? e.message :
      (e.message ? [{ type: 'text', text: String(e.message) }] : [])
    // 特定适配器的属性（atList、atBot等）由适配器增强插件初始化
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
    // 通用事件属性设置
    e.isDevice = this.isDeviceEvent(e)
    e.isStdin = this.isStdinEvent(e)

    // 基础sender信息
    if (!e.sender) {
      e.sender = {}
    }
    e.sender.nickname ||= e.sender.card || e.device_name || ''
    e.sender.card ||= e.sender.nickname

    // 基础日志文本
    if (e.isDevice) {
      e.logText = `[设备][${e.device_name || e.device_id}][${e.event_type || '事件'}]`
    } else if (e.isStdin) {
      e.logText = `[${e.adapter === 'api' ? 'API' : 'STDIN'}][${e.user_id || '未知'}]`
    } else {
      // 通用格式，适配器增强插件可以覆盖
      e.logText = `[${e.adapter || '未知'}][${e.user_id || '未知'}]`
    }

    // 特定适配器的属性（isPrivate、isGroup、group、friend、recall等）由适配器增强插件设置
  }

  checkPermissions(e) {
    const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || []
    const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]

    if (masters.some(id => String(e.user_id) === String(id))) {
      e.isMaster = true
    } else if (e.isStdin && e.isMaster === undefined) {
      e.isMaster = true
    }
  }

  processAlias(e) {
    // 通用别名处理，需要group_id时才处理
    if (!e.group_id) return
    
    const alias = cfg.getGroup(e.group_id)?.botAlias
    if (!alias) return

    const aliases = Array.isArray(alias) ? alias : [alias]
    for (const a of aliases) {
      if (a && e.msg.startsWith(a)) {
        e.msg = e.msg.slice(a.length).trim()
        e.hasAlias = true
        break
      }
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
          logger.error(`发送消息错误: ${err.message}`)
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
        logger.error('回复消息处理错误')
        logger.error(error)
        return { error: error.message }
      }
    }
  }

  async runPlugins(e, isExtended = false) {
    try {
      const plugins = await this.initPlugins(e, isExtended)

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
          logger.error(`插件 ${plugin.name} accept错误`)
          logger.error(error)
        }
      }

      if (!e.isDevice && !e.isStdin) {
        if (await this.handleContext(plugins, e)) return true
        if (!this.onlyReplyAt(e)) return false

        const shouldSetLimit = !plugins.some(p => p.bypassThrottle === true)
        if (shouldSetLimit) this.setLimit(e)
      }

      return await this.processPlugins(plugins, e, false)
    } catch (error) {
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
        plugin.bypassThrottle = p.bypassThrottle

        if (plugin.rule) {
          plugin.rule.forEach(rule => {
            if (rule.reg) rule.reg = this.createRegExp(rule.reg)
          })
        }

        if (this.checkDisable(plugin) && this.filtEvent(e, plugin)) {
          activePlugins.push(plugin)
        }
      } catch (error) {
        logger.error(`初始化插件 ${p.name} 失败`)
        logger.error(error)
      }
    }

    return activePlugins
  }

  async processPlugins(plugins, e, isExtended) {
    if (!Array.isArray(plugins)) {
      logger.error('processPlugins: plugins参数不是数组')
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
      logger.error('processRules: plugins参数不是数组')
      return false
    }

    for (const plugin of plugins) {
      if (!plugin?.rule) continue

      for (const v of plugin.rule) {
        if (v.event && !this.filtEvent(e, v)) continue
        if (v.reg && e.msg !== undefined && !v.reg.test(e.msg)) continue

        e.logFnc = `[${plugin.name}][${v.fnc}]`

        if (v.log !== false) {
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
          logger.error(`${e.logFnc} 执行错误`)
          logger.error(error)
        }
      }
    }
    return false
  }

  async processDefaultHandlers(e) {
    if (e.isDevice || e.isStdin) return false

    for (const handler of this.defaultMsgHandlers) {
      try {
        const plugin = new handler.class(e)
        plugin.e = e
        if (typeof plugin.handleNonMatchMsg === 'function') {
          const res = await plugin.handleNonMatchMsg(e)
          if (res === 'return' || res) return true
        }
      } catch (error) {
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
              logger.error(`上下文方法 ${fnc} 执行错误`)
              logger.error(error)
            }
          }
        }
      }
    }
    return false
  }

  isStdinEvent(e) {
    return e.adapter === 'api' || e.adapter === 'stdin' || e.source === 'api' || e.isStdin
  }

  isDeviceEvent(e) {
    return e.post_type === 'device' || e.adapter === 'device' ||
      e.isDevice || !!e.device_id ||
      (e.event_type && Bot[e.self_id])
  }
  initEvent(e) {
    if (!e.self_id) {
      if (e.device_id) {
        e.self_id = e.device_id
      } else if (this.isStdinEvent(e)) {
        e.self_id = 'stdin'
      } else if (Bot.uin?.length > 0) {
        e.self_id = Bot.uin[0]
      }
    }

    // 设置适配器类型（通用逻辑，不假设特定适配器）
    if (!e.adapter) {
      // 优先使用适配器标识
      if (e.adapter_name) {
        // 从适配器名称推断类型
        const adapterName = e.adapter_name.toLowerCase()
        if (adapterName.includes('onebot')) e.adapter = 'onebot'
        else if (adapterName.includes('device')) e.adapter = 'device'
        else if (adapterName.includes('stdin')) e.adapter = 'stdin'
      }
      
      // 如果没有适配器名称，使用事件类型推断
      if (!e.adapter) {
        if (e.isDevice || e.device_id) e.adapter = 'device'
        else if (e.isStdin || this.isStdinEvent(e)) e.adapter = 'stdin'
        else if (e.isOneBot) e.adapter = 'onebot'
        // 默认值由适配器在发送事件时设置，这里不设置默认值
      }
    }

    let bot = null
    if (this.isStdinEvent(e)) {
      bot = Bot.stdin || Bot['stdin'] || Bot
    } else if (e.device_id && Bot[e.device_id]) {
      bot = Bot[e.device_id]
    } else if (e.self_id && Bot[e.self_id]) {
      bot = Bot[e.self_id]
    } else {
      bot = Bot
    }

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
      e.event_id = `${e.adapter || 'event'}_${postType}_${Date.now()}_${randomId}`
    }

    this.count(e, 'receive')
  }

  async preCheck(e, hasBypassPlugin = false) {
    try {
      if (e.isDevice || e.isStdin) return true

      const botUin = e.self_id || Bot.uin?.[0]
      if (cfg.bot?.ignore_self !== false && e.user_id === botUin) {
        return false
      }

      let msg = e.raw_message || ''
      if (!msg && e.message) {
        if (Array.isArray(e.message)) {
          msg = e.message
            .filter(m => m.type === 'text')
            .map(m => m.text || '')
            .join('')
        } else {
          msg = e.message.toString()
        }
      }

      msg = this.dealText(msg)
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
      logger.error('前置检查错误')
      logger.error(error)
      return false
    }
  }

  async checkBypassPlugins(e) {
    if (!e.message) return false

    for (const p of this.priority) {
      if (!p.bypassThrottle || !p.class) continue

      try {
        const plugin = new p.class(e)
        plugin.e = e

        if (plugin.rule) {
          const tempMsg = this.extractMessageText(e)
          for (const rule of plugin.rule) {
            if (rule.reg) {
              rule.reg = this.createRegExp(rule.reg)
              if (rule.reg.test(tempMsg)) return true
            }
          }
        }
      } catch (error) {
        logger.error('检查bypass插件错误')
        logger.error(error)
      }
    }

    return false
  }

  extractMessageText(e) {
    if (e.raw_message) return this.dealText(e.raw_message)
    if (!e.message) return ''

    const messages = Array.isArray(e.message) ? e.message : [e.message]
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

  async getPlugins() {
    try {
      const files = await fs.readdir(this.dir, { withFileTypes: true })
      const ret = []

      for (const dir of files) {
        if (!dir.isDirectory()) continue
        const dirPath = `${this.dir}/${dir.name}`

        if (existsSync(`${dirPath}/index.js`)) {
          ret.push({
            name: dir.name,
            path: `../../../${dirPath}/index.js`
          })
          continue
        }

        const apps = await fs.readdir(dirPath, { withFileTypes: true })
        for (const app of apps) {
          if (!app.isFile() || !app.name.endsWith('.js')) continue
          const key = `${dir.name}/${app.name}`
          ret.push({
            name: key,
            path: `../../../${dirPath}/${app.name}`
          })
          this.watch(dir.name, app.name)
        }
      }
      return ret
    } catch (error) {
      logger.error('获取插件文件列表失败')
      logger.error(error)
      return []
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

      if (plugin.rule) {
        plugin.rule.forEach(rule => {
          if (rule.reg) rule.reg = this.createRegExp(rule.reg)
        })
      }

      const pluginData = {
        class: p,
        key: file.name,
        name: plugin.name,
        priority: plugin.priority === 'extended' ? 0 : (plugin.priority ?? 50),
        plugin,
        bypassThrottle: plugin.bypassThrottle === true
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
    
    if (e.isOneBot || e.adapter === 'onebot') {
      const postType = e.post_type || ''
      const typeKey = postType === 'message' ? 'message_type' : 
                     postType === 'notice' ? 'notice_type' : 
                     postType === 'request' ? 'request_type' : ''
      const type = e[typeKey] || ''
      const subType = e.sub_type || ''
      
      if (postType && type && subType) possibleEvents.push(`onebot.${postType}.${type}.${subType}`)
      if (postType && type) possibleEvents.push(`onebot.${postType}.${type}`)
      if (postType) {
        possibleEvents.push(`onebot.${postType}`)
        genericEvents.push(postType)
      }
    } else if (e.isDevice || e.adapter === 'device' || e.post_type === 'device') {
      const eventType = e.event_type || ''
      if (eventType) {
        possibleEvents.push(`device.${eventType}`)
        genericEvents.push(eventType)
      }
      possibleEvents.push('device')
    } else if (e.isStdin || e.adapter === 'stdin') {
      const eventType = e.command ? 'command' : (e.post_type || 'message')
      if (eventType) {
        possibleEvents.push(`stdin.${eventType}`)
        genericEvents.push(eventType)
      }
      possibleEvents.push('stdin')
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
    if (e.isDevice || e.isStdin) return true
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
    if (e.isDevice || e.isStdin) return true

    // 特定适配器的限制检查（如群禁言等）由适配器增强插件处理
    // 这里只做通用的冷却检查

    if (!e.message || !e.group_id || ['cmd'].includes(e.adapter)) {
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
    if (e.isStdin) return

    const adapter = e.adapter || ''
    if (!e.message || !e.group_id || ['cmd'].includes(adapter)) return

    const groupConfig = cfg.getGroup(e.group_id) || {}
    const otherConfig = cfg.getOther() || {}
    const config = Object.keys(groupConfig).length > 0 ? groupConfig : otherConfig

    const setCooldown = (type, key, time) => {
      if (time > 0) {
        this.cooldowns[type].set(key, Date.now())
        setTimeout(() => this.cooldowns[type].delete(key), time)
      }
    }

    if (e.isDevice) {
      setCooldown('device', e.device_id, config.deviceCD || 1000)
    } else if (e.group_id) {
      setCooldown('group', e.group_id, config.groupGlobalCD || 0)
      setCooldown('single', `${e.group_id}.${e.user_id}`, config.singleCD || 0)
    }
  }

  onlyReplyAt(e) {
    if (e.isDevice || e.isStdin) return true
    if (!e.message || !e.group_id || ['cmd'].includes(e.adapter || '')) return true

    const groupCfg = cfg.getGroup(e.group_id) || {}
    const onlyReplyAt = groupCfg.onlyReplyAt ?? 0

    // 如果没有设置onlyReplyAt，或者没有botAlias，则允许回复
    if (onlyReplyAt === 0 || !groupCfg.botAlias) return true
    
    // 主人权限或已使用别名
    if ((onlyReplyAt === 2 && e.isMaster) || e.hasAlias) return true
    
    // 检查是否@了机器人（由适配器增强插件设置atBot属性）
    return e.atBot === true
  }


  checkDisable(p) {
    if (!p) return false
    if (!p.e) return true

    if (p.e.isDevice || p.e.isStdin) {
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
        if (this.eventHistory.length > this.MAX_EVENT_HISTORY) {
          this.eventHistory = this.eventHistory.slice(-this.MAX_EVENT_HISTORY)
        }

        const now = Date.now()

        for (const [key, time] of this.eventThrottle) {
          if (now - time > 60000) {
            this.eventThrottle.delete(key)
          }
        }

        for (const [key, time] of this.msgThrottle) {
          if (now - time > 5000) {
            this.msgThrottle.delete(key)
          }
        }

        for (const cooldownType of ['group', 'single', 'device']) {
          for (const [key, time] of this.cooldowns[cooldownType]) {
            if (now - time > 300000) {
              this.cooldowns[cooldownType].delete(key)
            }
          }
        }
      } catch (error) {
        logger.error('清理定时器执行错误')
        logger.error(error)
      }
    }, 60000)

    this.registerGlobalEventListeners()
  }

  registerGlobalEventListeners() {
  }

  recordEventHistory(eventType, eventData) {
    const historyEntry = {
      event_id: eventData.event_id || Date.now().toString(),
      event_type: eventType,
      event_data: eventData,
      timestamp: Date.now(),
      source: eventData.adapter || eventData.device_id || 'internal'
    }

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
    if (e.isDevice || e.isStdin) return

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
      const timestamp = moment().format('x')
      let app = await import(`../../../${this.dir}/${key}?${timestamp}`)
      app = app.apps ? { ...app.apps } : app

      Object.values(app).forEach(p => {
        if (!p?.prototype) return

        const plugin = new p()

        if (plugin.rule) {
          plugin.rule.forEach(rule => {
            if (rule.reg) rule.reg = this.createRegExp(rule.reg)
          })
        }

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

        if (plugin.priority === 'extended') {
          update(this.extended)
        } else {
          update(this.priority)
        }
      })

      this.sortPlugins()
      this.identifyDefaultMsgHandlers()
      logger.mark(`[热更新插件][${key}]`)
    } catch (error) {
      logger.error(`热更新插件错误: ${key}`)
      logger.error(error)
    }
  }

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
              path: `../../../${this.dir}/${key}?${moment().format('X')}`
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

            this.priority = this.priority.filter(p => p.key !== key)
            this.extended = this.extended.filter(p => p.key !== key)
            this.identifyDefaultMsgHandlers()

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
      logger.error('销毁插件加载器失败')
      logger.error(error)
    }
  }
}

export default new PluginsLoader()