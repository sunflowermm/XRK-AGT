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
import { segment } from 'oicq'

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
    this.dir = 'plugins'            // 插件目录
    this.watcher = {}               // 文件监听器
    this.cooldowns = {              // 冷却时间管理
      group: new Map(),             // 使用 Map 替代对象，性能更好
      single: new Map(),
      device: new Map()
    }
    this.msgThrottle = new Map()    // 消息节流
    this.eventThrottle = new Map()  // 事件节流
    this.defaultMsgHandlers = []    // 默认消息处理器
    this.eventSubscribers = new Map() // 事件订阅者
    this.pluginCount = 0            // 插件计数
    this.eventHistory = []          // 事件历史
    this.MAX_EVENT_HISTORY = 1000   // 最大事件历史记录数
    this.cleanupTimer = null        // 清理定时器
    this.pluginLoadStats = {
      plugins: [],
      totalLoadTime: 0,
      startTime: 0,
      totalPlugins: 0,
      taskCount: 0,
      extendedCount: 0
    };
  }

  /**
   * 加载所有插件
   */
  async load(isRefresh = false) {
    try {
      if (!isRefresh && this.priority.length) return

      // 记录开始时间
      this.pluginLoadStats.startTime = Date.now();
      this.pluginLoadStats.plugins = [];

      // 重置插件列表
      this.priority = []
      this.extended = []
      this.delCount()

      logger.info('-----------')
      logger.title('开始加载插件', 'yellow')

      // 获取所有插件文件
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

      // 显示加载结果
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

      const hasBypassPlugin = await this.checkBypassPlugins(e)

      const shouldContinue = await this.preCheck(e, hasBypassPlugin)
      if (!shouldContinue) return

      // 处理消息
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

  /**
   * 处理消息内容
   * @param {Object} e - 事件对象
   */
  async dealMsg(e) {
    try {
      // 初始化消息属性
      this.initMsgProps(e)

      // 解析消息
      await this.parseMessage(e)

      // 设置事件属性
      this.setupEventProps(e)

      // 检查权限
      this.checkPermissions(e)

      // 处理别名
      if (e.msg && e.isGroup && !e.isDevice && !e.isStdin) {
        this.processAlias(e)
      }

      // 添加工具方法
      this.addUtilMethods(e)
    } catch (error) {
      logger.error('处理消息内容错误')
      logger.error(error)
    }
  }

  /**
   * 初始化消息属性
   * @param {Object} e - 事件对象
   */
  initMsgProps(e) {
    e.img = []
    e.video = []
    e.audio = []
    e.msg = ''
    e.atList = []
    e.atBot = false
    e.message = Array.isArray(e.message) ? e.message :
      (e.message ? [{ type: 'text', text: String(e.message) }] : [])
  }

  /**
   * 解析消息内容
   * @param {Object} e - 事件对象
   */
  async parseMessage(e) {
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
        case 'at':
          const id = val.qq || val.id
          if (id == e.bot?.uin || id == e.bot?.tiny_id) {
            e.atBot = true
          } else if (id) {
            e.at = id
            e.atList.push(id)
          }
          break
        case 'reply':
          e.source = {
            message_id: val.id,
            seq: val.data?.seq,
            time: val.data?.time,
            user_id: val.data?.user_id,
            raw_message: val.data?.message,
          }
          e.reply_id = val.id
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
        case 'face':
          if (!e.face) e.face = []
          if (val.id !== undefined) e.face.push(val.id)
          break
      }
    }
  }

  /**
   * 设置事件属性
   * @param {Object} e - 事件对象
   */
  setupEventProps(e) {
    // 设置事件类型标识
    e.isPrivate = e.message_type === 'private' || e.notice_type === 'friend'
    e.isGroup = e.message_type === 'group' || e.notice_type === 'group'
    e.isGuild = e.detail_type === 'guild'
    e.isDevice = this.isDeviceEvent(e)
    e.isStdin = this.isStdinEvent(e)

    // 设置发送者信息
    if (!e.sender) {
      e.sender = e.member || e.friend || {}
    }
    e.sender.card ||= e.sender.nickname || e.device_name || ''
    e.sender.nickname ||= e.sender.card

    // 构建日志文本
    if (e.isDevice) {
      e.logText = `[设备][${e.device_name || e.device_id}][${e.event_type || '事件'}]`
    } else if (e.isStdin) {
      e.logText = `[${e.adapter === 'api' ? 'API' : 'STDIN'}][${e.user_id || '未知'}]`
    } else if (e.isPrivate) {
      e.logText = `[私聊][${e.sender.card}(${e.user_id})]`
    } else if (e.isGroup) {
      e.logText = `[${e.group_name || e.group_id}(${e.group_id})][${e.sender.card}(${e.user_id})]`
    }

    // 设置获取回复消息方法
    e.getReply = async () => {
      const msgId = e.source?.message_id || e.reply_id
      if (!msgId) return null
      try {
        const target = e.isGroup ? e.group : e.friend
        return target?.getMsg ? await target.getMsg(msgId) : null
      } catch (error) {
        logger.debug(`获取回复消息失败: ${error.message}`)
        return null
      }
    }

    // 设置撤回方法
    if (!e.recall && e.message_id && !e.isDevice && !e.isStdin) {
      const target = e.isGroup ? e.group : e.friend
      if (target?.recallMsg) {
        e.recall = () => target.recallMsg(e.message_id)
      }
    }
  }

  /**
   * 检查权限
   * @param {Object} e - 事件对象
   */
  checkPermissions(e) {
    const masterQQ = cfg.masterQQ || cfg.master?.[e.self_id] || []
    const masters = Array.isArray(masterQQ) ? masterQQ : [masterQQ]

    if (masters.some(id => String(e.user_id) === String(id))) {
      e.isMaster = true
    }

    // stdin事件默认为主人权限
    if (e.isStdin && e.isMaster === undefined) {
      e.isMaster = true
    }
  }

  /**
   * 处理群聊别名
   * @param {Object} e - 事件对象
   */
  processAlias(e) {
    const groupCfg = cfg.getGroup(e.group_id)
    const alias = groupCfg?.botAlias
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
   * 运行插件
   * @param {Object} e - 事件对象
   * @param {boolean} isExtended - 是否为扩展插件
   * @returns {Promise<boolean>}
   */
  async runPlugins(e, isExtended = false) {
    try {
      const plugins = await this.initPlugins(e, isExtended)

      // 处理扩展插件 - 直接运行，不进行其他检查
      if (isExtended) {
        return await this.processPlugins(plugins, e, true)
      }

      // 处理accept方法
      for (const plugin of plugins) {
        if (plugin?.accept) {
          try {
            const res = await plugin.accept(e)

            // 检查是否需要重新解析
            if (e._needReparse) {
              delete e._needReparse
              this.initMsgProps(e)
              await this.parseMessage(e)
            }

            if (res === 'return') return true
            if (res) break
          } catch (error) {
            logger.error(`插件 ${plugin.name} accept错误`)
            logger.error(error)
          }
        }
      }

      // 处理上下文和限制（仅普通消息）
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

  /**
   * 初始化插件列表
   * @param {Object} e - 事件对象
   * @param {boolean} isExtended - 是否为扩展插件
   * @returns {Promise<Array>}
   */
  async initPlugins(e, isExtended = false) {
    const pluginList = isExtended ? this.extended : this.priority
    const activePlugins = []

    for (const p of pluginList) {
      if (!p?.class) continue

      try {
        const plugin = new p.class(e)
        plugin.e = e
        plugin.bypassThrottle = p.bypassThrottle

        // 编译规则正则
        if (plugin.rule) {
          plugin.rule.forEach(rule => {
            if (rule.reg) rule.reg = this.createRegExp(rule.reg)
          })
        }

        // 检查插件是否启用
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

  /**
   * 处理插件执行
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @param {boolean} isExtended - 是否为扩展插件
   * @returns {Promise<boolean>}
   */
  async processPlugins(plugins, e, isExtended) {
    // 确保plugins是数组
    if (!Array.isArray(plugins)) {
      logger.error('processPlugins: plugins参数不是数组')
      return false
    }

    if (!plugins.length) return false

    // 扩展插件直接处理规则
    if (isExtended) {
      return await this.processRules(plugins, e)
    }

    // 普通插件按优先级分组处理
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

    // 处理默认消息处理器
    return await this.processDefaultHandlers(e)
  }

  /**
   * 处理插件规则
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
  async processRules(plugins, e) {
    // 确保plugins是数组
    if (!Array.isArray(plugins)) {
      logger.error('processRules: plugins参数不是数组')
      return false
    }

    for (const plugin of plugins) {
      if (!plugin?.rule) continue

      for (const v of plugin.rule) {
        // 检查事件类型
        if (v.event && !this.filtEvent(e, v)) continue

        // 检查正则匹配
        if (v.reg && e.msg !== undefined && !v.reg.test(e.msg)) continue

        // 设置日志函数名
        e.logFnc = `[${plugin.name}][${v.fnc}]`

        // 记录日志
        if (v.log !== false) {
          logger.info(`${e.logFnc}${e.logText} ${lodash.truncate(e.msg || '', { length: 100 })}`)
        }

        // 检查权限
        if (!this.filtPermission(e, v)) return true

        try {
          const start = Date.now()

          // 执行插件方法
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

  /**
   * 处理默认消息处理器
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
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

  /**
   * 处理上下文
   * @param {Array} plugins - 插件列表
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
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
      if (e.message) await this.dealMsg(e)
      this.setupReply(e)

      // 运行插件
      await this.runPlugins(e, true)
      const handled = await this.runPlugins(e, false)

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
        e.message = e.event_data.message
        e.raw_message = typeof e.message === 'string' ? e.message : JSON.stringify(e.message)
        e.msg = e.raw_message
        await this.dealMsg(e)
      }

      // 运行普通插件
      await this.runPlugins(e, true)
      const handled = await this.runPlugins(e, false)

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
      msg = this.dealText(msg)
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
   * 检查是否有绕过节流的插件
   * @param {Object} e - 事件对象
   * @returns {Promise<boolean>}
   */
  async checkBypassPlugins(e) {
    if (!e.message) return false

    for (const p of this.priority) {
      if (!p.bypassThrottle || !p.class) continue

      try {
        const plugin = new p.class(e)
        plugin.e = e

        if (plugin.rule) {
          for (const rule of plugin.rule) {
            if (rule.reg) {
              rule.reg = this.createRegExp(rule.reg)
              const tempMsg = this.extractMessageText(e)
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

  /**
   * 提取消息文本
   * @param {Object} e - 事件对象
   * @returns {string}
   */
  extractMessageText(e) {
    if (e.raw_message) return this.dealText(e.raw_message)
    if (!e.message) return ''

    let text = ''
    const messages = Array.isArray(e.message) ? e.message : [e.message]

    for (const msg of messages) {
      if (msg.type === 'text') {
        text += msg.text || ''
      }
    }

    return this.dealText(text)
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
      const userId = e.user_id || e.device_id
      const throttleKey = `${userId}:${key}`
      if (this.eventThrottle.has(throttleKey)) return false

      this.eventThrottle.set(throttleKey, Date.now())
      setTimeout(() => this.eventThrottle.delete(throttleKey), duration)
      return true
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
      const files = await fs.readdir(this.dir, { withFileTypes: true })
      const ret = []

      for (const dir of files) {
        if (!dir.isDirectory()) continue
        const dirPath = `${this.dir}/${dir.name}`

        // 检查是否有index.js
        if (existsSync(`${dirPath}/index.js`)) {
          ret.push({
            name: dir.name,
            path: `../../${dirPath}/index.js`
          })
          continue
        }

        // 扫描目录下的js文件
        const apps = await fs.readdir(dirPath, { withFileTypes: true })
        for (const app of apps) {
          if (!app.isFile() || !app.name.endsWith('.js')) continue
          const key = `${dir.name}/${app.name}`
          ret.push({
            name: key,
            path: `../../${dirPath}/${app.name}`
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

      // 初始化插件
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

      // 处理定时任务
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

      // 处理规则
      if (plugin.rule) {
        plugin.rule.forEach(rule => {
          if (rule.reg) rule.reg = this.createRegExp(rule.reg)
        })
      }

      // 普通插件
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

      // 处理handler
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

      // 注册事件订阅
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
   * 过滤事件
   * @param {Object} e - 事件对象
   * @param {Object} v - 规则对象
   * @returns {boolean}
   */
  filtEvent(e, v) {
    if (!v.event) return true

    const event = v.event.split('.')
    const postType = e.post_type || ''
    const eventMap = EVENT_MAP[postType] || []
    const newEvent = event.map((val, i) => {
      if (val === '*') return val
      const mapKey = eventMap[i]
      return mapKey && e[mapKey] ? e[mapKey] : ''
    })

    return v.event === newEvent.join('.')
  }

  /**
   * 过滤权限
   * @param {Object} e - 事件对象
   * @param {Object} v - 规则对象
   * @returns {boolean}
   */
  filtPermission(e, v) {
    // 特殊事件直接通过
    if (e.isDevice || e.isStdin) return true

    // 无权限要求或主人权限直接通过
    if (!v.permission || v.permission === 'all' || e.isMaster) return true

    const permissionMap = {
      master: {
        check: () => false,
        msg: '暂无权限，只有主人才能操作'
      },
      owner: {
        check: () => e.member?.is_owner === true,
        msg: '暂无权限，只有群主才能操作'
      },
      admin: {
        check: () => e.member?.is_owner === true || e.member?.is_admin === true,
        msg: '暂无权限，只有管理员才能操作'
      }
    }

    const perm = permissionMap[v.permission]
    if (!perm || !e.isGroup) return true

    if (!perm.check()) {
      e.reply(perm.msg)
      return false
    }

    return true
  }

  /**
   * 检查消息限制
   * @param {Object} e - 事件对象
   * @returns {boolean}
   */
  checkLimit(e) {
    // 特殊事件直接通过
    if (e.isDevice || e.isStdin) return true

    // 检查群聊禁言
    if (e.isGroup && e.group) {
      const muteLeft = e.group.mute_left ?? 0
      const allMuted = e.group.all_muted === true
      const isAdmin = e.group.is_admin === true
      const isOwner = e.group.is_owner === true

      if (muteLeft > 0 || (allMuted && !isAdmin && !isOwner)) {
        return false
      }
    }

    // 私聊或特殊适配器直接通过
    if (!e.message || e.isPrivate || ['cmd'].includes(e.adapter)) {
      return true
    }

    // 检查CD限制
    const config = e.group_id ? cfg.getGroup(e.group_id) : {}

    const groupCD = config.groupGlobalCD || 0
    const singleCD = config.singleCD || 0
    const deviceCD = config.deviceCD || 0

    if ((groupCD && this.cooldowns.group.has(e.group_id)) ||
      (singleCD && this.cooldowns.single.has(`${e.group_id}.${e.user_id}`)) ||
      (e.device_id && deviceCD && this.cooldowns.device.has(e.device_id))) {
      return false
    }

    // 消息去重
    const msgId = e.message_id ?
      `${e.user_id}:${e.message_id}` :
      `${e.user_id}:${Date.now()}:${Math.random()}`

    if (this.msgThrottle.has(msgId)) return false

    this.msgThrottle.set(msgId, Date.now())
    setTimeout(() => this.msgThrottle.delete(msgId), 5000)

    return true
  }

  /**
   * 设置消息限制
   * @param {Object} e - 事件对象
   */
  setLimit(e) {
    if (e.isStdin) return

    const adapter = e.adapter || ''
    if (!e.message || (e.isPrivate && !e.isDevice) || ['cmd'].includes(adapter)) return

    const groupConfig = e.group_id ? cfg.getGroup(e.group_id) : {}
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
    } else {
      setCooldown('group', e.group_id, config.groupGlobalCD || 0)
      setCooldown('single', `${e.group_id}.${e.user_id}`, config.singleCD || 0)
    }
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
   * 检查插件禁用状态
   * @param {Object} p - 插件对象
   * @returns {boolean}
   */
  checkDisable(p) {
    if (!p) return false

    // 设备和stdin事件的特殊处理
    if (p.e && (p.e.isDevice || p.e.isStdin)) {
      const other = cfg.getOther()
      if (!other) return true

      const disableDevice = other.disableDevice || []
      const enableDevice = other.enableDevice || []

      if (Array.isArray(disableDevice) && disableDevice.includes(p.name)) return false
      if (Array.isArray(enableDevice) && enableDevice.length > 0 && !enableDevice.includes(p.name)) {
        return false
      }
      return true
    }

    // 非群聊直接通过
    if (!p.e || !p.e.group_id) return true

    const groupCfg = cfg.getGroup(p.e.group_id)
    if (!groupCfg) return true

    const disable = groupCfg.disable || []
    const enable = groupCfg.enable || []

    if (Array.isArray(disable) && disable.includes(p.name)) return false
    if (Array.isArray(enable) && enable.length > 0 && !enable.includes(p.name)) return false

    return true
  }

  /**
   * 创建正则表达式
   * @param {string|RegExp} pattern - 正则模式
   * @returns {RegExp|boolean}
   */
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
    // 处理斜杠转换
    if (cfg.bot?.['/→#']) text = text.replace(/^\s*\/\s*/, '#')
    // 规范化命令前缀
    return text
      .replace(/^\s*[＃井#]+\s*/, '#')
      .replace(/^\s*[\\*※＊]+\s*/, '*')
      .trim()
  }

  /**
   * 初始化事件系统
   */
  initEventSystem() {
    // 清理旧的定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    // 定期清理事件历史和节流记录
    this.cleanupTimer = setInterval(() => {
      try {
        // 清理事件历史
        if (this.eventHistory.length > this.MAX_EVENT_HISTORY) {
          this.eventHistory = this.eventHistory.slice(-this.MAX_EVENT_HISTORY)
        }

        const now = Date.now()

        // 清理过期的事件节流记录
        for (const [key, time] of this.eventThrottle) {
          if (now - time > 60000) {
            this.eventThrottle.delete(key)
          }
        }

        // 清理过期的消息节流记录
        for (const [key, time] of this.msgThrottle) {
          if (now - time > 5000) {
            this.msgThrottle.delete(key)
          }
        }

        // 清理过期的冷却记录
        for (const cooldownType of ['group', 'single', 'device']) {
          for (const [key, time] of this.cooldowns[cooldownType]) {
            if (now - time > 300000) { // 5分钟
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
      let app = await import(`../../${this.dir}/${key}?${timestamp}`)
      app = app.apps ? { ...app.apps } : app

      Object.values(app).forEach(p => {
        if (!p?.prototype) return

        const plugin = new p()

        // 编译规则正则
        if (plugin.rule) {
          plugin.rule.forEach(rule => {
            if (rule.reg) rule.reg = this.createRegExp(rule.reg)
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

      // 清理内存
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