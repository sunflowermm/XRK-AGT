import pino from 'pino'
import chalk from 'chalk'
import cfg from './config/config.js'
import path from 'node:path'
import util from 'node:util'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import schedule from 'node-schedule'
import { createStream } from 'rotating-file-stream'
import { execSync } from 'node:child_process'
import paths from '#utils/paths.js'

/**
 * Logger 配置常量
 */
const LOGGER_CONFIG = {
  MAIN_LOG_PREFIX: 'app',
  TRACE_LOG_PREFIX: 'trace',
  ROTATION_INTERVAL: '1d',
  CLEANUP_TIME: '0 3 * * *',
  DEFAULT_MAX_DAYS: 3,
  DEFAULT_TRACE_DAYS: 1
}

/**
 * 颜色方案配置
 */
const COLOR_SCHEMES = {
  default: ['#3494E6', '#3498db', '#00b4d8', '#0077b6', '#023e8a'],
  scheme1: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF'],
  scheme2: ['#FF69B4', '#FF1493', '#C71585', '#DB7093', '#FFC0CB'],
  scheme3: ['#00CED1', '#20B2AA', '#48D1CC', '#008B8B', '#5F9EA0'],
  scheme4: ['#8A2BE2', '#9370DB', '#7B68EE', '#6A5ACD', '#483D8B'],
  scheme5: ['#36D1DC', '#5B86E5', '#4776E6', '#8E54E9', '#6A82FB'],
  scheme6: ['#FF512F', '#F09819', '#FF8008', '#FD746C', '#FE9A8B'],
  scheme7: ['#11998e', '#38ef7d', '#56ab2f', '#a8e063', '#76b852']
}

const TIMESTAMP_SCHEMES = {
  default: ['#64B5F6', '#90CAF9', '#BBDEFB', '#E3F2FD', '#B3E5FC'],
  scheme1: ['#FFCCBC', '#FFAB91', '#FF8A65', '#FF7043', '#FF5722'],
  scheme2: ['#F8BBD0', '#F48FB1', '#F06292', '#EC407A', '#E91E63'],
  scheme3: ['#B2DFDB', '#80CBC4', '#4DB6AC', '#26A69A', '#009688'],
  scheme4: ['#D1C4E9', '#B39DDB', '#9575CD', '#7E57C2', '#673AB7'],
  scheme5: ['#90CAF9', '#64B5F6', '#42A5F5', '#2196F3', '#1E88E5'],
  scheme6: ['#FFAB91', '#FF8A65', '#FF7043', '#FF5722', '#F4511E'],
  scheme7: ['#A5D6A7', '#81C784', '#66BB6A', '#4CAF50', '#43A047']
}

/**
 * 日志级别样式配置
 */
const LOG_STYLES = {
  trace: { symbol: '•', color: 'grey', level: 10 },
  debug: { symbol: '⚙', color: 'cyan', level: 20 },
  info: { symbol: 'ℹ', color: 'blue', level: 30 },
  warn: { symbol: '⚠', color: 'yellow', level: 40 },
  error: { symbol: '✗', color: 'red', level: 50 },
  fatal: { symbol: '☠', color: 'redBright', level: 60 },
  mark: { symbol: '✧', color: 'magenta', level: 30 },
  success: { symbol: '✓', color: 'green', level: 30 },
  tip: { symbol: '💡', color: 'yellow', level: 30 },
  done: { symbol: '✓', color: 'greenBright', level: 30 }
}

/**
 * 初始化日志系统
 * @returns {Object} 全局 logger 对象
 */
export default function setLog() {
  fixWindowsUTF8()

  const logDir = paths.logs || path.join(process.cwd(), 'logs')
  const logCfg = cfg.agt?.logging || {}
  const selectedScheme = COLOR_SCHEMES[logCfg.color] || COLOR_SCHEMES.default
  const selectedTimestampColors = TIMESTAMP_SCHEMES[logCfg.color] || TIMESTAMP_SCHEMES.default

  const fileStream = createRotatingStream(logDir, LOGGER_CONFIG.MAIN_LOG_PREFIX, logCfg.maxDays || LOGGER_CONFIG.DEFAULT_MAX_DAYS)
  const traceStream = createRotatingStream(logDir, LOGGER_CONFIG.TRACE_LOG_PREFIX, logCfg.traceDays || LOGGER_CONFIG.DEFAULT_TRACE_DAYS)

  const pinoLogger = pino(
    {
      level: 'trace',
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label })
      }
    },
    pino.multistream([
      { stream: fileStream, level: 'debug' },
      { stream: traceStream, level: 'trace' }
    ])
  )

  const timers = new Map()
  let cleanupJob = null

  const canLog = (level) => {
    const configLevel = cfg.agt?.logging?.level || 'info'
    const targetLevel = LOG_STYLES[level]?.level || 30
    const configLevelValue = LOG_STYLES[configLevel]?.level || 30
    return targetLevel >= configLevelValue
  }

  /**
   * 创建渐变文本
   * @param {string} text - 文本内容
   * @param {Array<string>} colors - 颜色数组
   * @returns {string} 渐变色文本
   */
  function createGradientText(text, colors = selectedScheme) {
    if (!text || text.length === 0) return text
    let result = ''
    const step = Math.max(1, Math.ceil(text.length / colors.length))

    for (let i = 0; i < text.length; i++) {
      const colorIndex = Math.floor(i / step) % colors.length
      result += chalk.hex(colors[colorIndex])(text[i])
    }
    return result
  }

  /**
   * 格式化时间戳
   * @returns {string} 格式化的时间戳
   */
  function formatTimestamp() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    const timestamp = `[${month}-${day} ${hours}:${minutes}:${seconds}]`

    return createGradientText(timestamp, selectedTimestampColors)
  }

  /**
   * 获取日志头部
   * @returns {string} 日志头部文本
   */
  function getLogHeader() {
    const headerText = cfg.agt?.logging?.align ? `[${cfg.agt.logging.align}]` : '[XRKYZ]'
    return createGradientText(headerText)
  }

  /**
   * 创建日志前缀
   * @param {string} level - 日志级别
   * @returns {string} 完整的日志前缀
   */
  function createLogPrefix(level) {
    const style = LOG_STYLES[level] || LOG_STYLES.info
    const header = getLogHeader()
    const timestamp = formatTimestamp()
    const symbol = chalk[style.color](style.symbol)
    return `${header} ${timestamp} ${symbol} `
  }

  /**
   * 移除 ANSI 颜色代码
   * @param {string} str - 原始字符串
   * @returns {string} 清理后的字符串
   */
  function stripColors(str) {
    if (typeof str !== 'string') return str
    return str
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\u001b\[[^m]*m/g, '')
      .replace(/\[38;5;\d+m/g, '')
      .replace(/\[39m/g, '')
      .replace(/\[\d+m/g, '')
  }

  /**
   * 确保 UTF-8 编码
   * @param {string} str - 原始字符串
   * @returns {string} UTF-8 编码的字符串
   */
  function ensureUTF8(str) {
    if (typeof str !== 'string') return str
    try {
      return Buffer.from(str, 'utf8').toString('utf8')
    } catch {
      return str
    }
  }

  /**
   * 格式化持续时间
   * @param {number} duration - 持续时间（毫秒）
   * @returns {string} 格式化的时间字符串
   */
  function formatDuration(duration) {
    if (duration < 1000) return `${duration}ms`
    if (duration < 60000) return `${(duration / 1000).toFixed(3)}s`
    const minutes = Math.floor(duration / 60000)
    const seconds = ((duration % 60000) / 1000).toFixed(3)
    return `${minutes}m ${seconds}s`
  }

  /**
   * 创建标准日志方法
   * @param {string} level - 日志级别
   * @returns {Function} 日志方法
   */
  function createLogMethod(level) {
    return function (...args) {
      const prefix = createLogPrefix(level)
      const message = args
        .map((arg) => {
          if (typeof arg === 'object' && !(arg instanceof Error)) {
            return util.inspect(arg, { colors: false, depth: null, maxArrayLength: null })
          }
          return ensureUTF8(String(arg))
        })
        .join(' ')

      const consoleMessage = prefix + message
      if (canLog(level)) {
        console.log(consoleMessage)
      }

      const fileMessage = stripColors(message)
      const pinoLevel = level === 'mark' || level === 'success' || level === 'tip' || level === 'done' ? 'info' : level

      if (args[0] instanceof Error) {
        const error = args[0]
        pinoLogger[pinoLevel]({ err: error }, fileMessage)
      } else {
        pinoLogger[pinoLevel](fileMessage)
      }
    }
  }

  const logger = {
    trace: createLogMethod('trace'),
    debug: createLogMethod('debug'),
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    fatal: createLogMethod('fatal'),
    mark: createLogMethod('mark'),

    chalk,
    red: (text) => chalk.red(text),
    green: (text) => chalk.green(text),
    yellow: (text) => chalk.yellow(text),
    blue: (text) => chalk.blue(text),
    magenta: (text) => chalk.magenta(text),
    cyan: (text) => chalk.cyan(text),
    gray: (text) => chalk.gray(text),
    white: (text) => chalk.white(text),

    xrkyzGradient: (text) => createGradientText(text, selectedScheme),
    rainbow: (text) => {
      const rainbowColors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3']
      return createGradientText(text, rainbowColors)
    },
    gradient: createGradientText,

    success: function (...args) {
      const prefix = createLogPrefix('success')
      const message = args
        .map((arg) => (typeof arg === 'string' ? ensureUTF8(arg) : util.inspect(arg, { colors: false })))
        .join(' ')

      const consoleMessage = prefix + chalk.green(message)
      if (canLog('success')) {
        console.log(consoleMessage)
      }

      pinoLogger.info(stripColors(message))
    },

    warning: function (...args) {
      this.warn(...args)
    },

    tip: function (...args) {
      const prefix = createLogPrefix('tip')
      const message = args
        .map((arg) => (typeof arg === 'string' ? ensureUTF8(arg) : util.inspect(arg, { colors: false })))
        .join(' ')

      const consoleMessage = prefix + chalk.yellow(message)
      if (canLog('tip')) {
        console.log(consoleMessage)
      }

      pinoLogger.info(stripColors(message))
    },

    /**
     * 计时器开始
     * @param {string} label - 计时器标签
     */
    time: function (label = 'default') {
      timers.set(label, Date.now())
    },

    /**
     * 计时器结束
     * @param {string} label - 计时器标签
     */
    timeEnd: function (label = 'default') {
      if (timers.has(label)) {
        const duration = Date.now() - timers.get(label)
        const timeStr = formatDuration(duration)
        const prefix = createLogPrefix('info')
        const message = `Timer ended ${chalk.cyan(label)}: ${chalk.yellow(timeStr)}`
        if (canLog('info')) {
          console.log(prefix + message)
        }

        pinoLogger.info(`Timer ended [${label}]: ${timeStr}`)
        timers.delete(label)
      } else {
        this.warn(`Timer ${label} does not exist`)
      }
    },

    /**
     * 完成日志
     * @param {string} text - 完成消息
     * @param {string} label - 计时器标签
     */
    done: function (text, label) {
      const prefix = createLogPrefix('done')
      let message = ensureUTF8(text || 'Operation completed')

      if (label && timers.has(label)) {
        const duration = Date.now() - timers.get(label)
        const timeStr = formatDuration(duration)
        message += ` (Duration: ${chalk.yellow(timeStr)})`
        timers.delete(label)
        pinoLogger.trace(`Operation completed [${label}]: ${text} - Duration ${timeStr}`)
      }

      const consoleMessage = prefix + chalk.green(message)
      if (canLog('done')) {
        console.log(consoleMessage)
      }

      pinoLogger.info(stripColors(message))
    },

    /**
     * 标题日志
     * @param {string} text - 标题文本
     * @param {string} color - 颜色
     */
    title: function (text, color = 'yellow') {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)
      const line = '═'.repeat(processedText.length + 10)

      if (canLog('info')) {
        console.log(prefix + chalk[color](line))
        console.log(prefix + chalk[color](`╔ ${processedText} ╗`))
        console.log(prefix + chalk[color](line))
      }

      pinoLogger.info(`=== ${processedText} ===`)
    },

    /**
     * 子标题日志
     * @param {string} text - 子标题文本
     * @param {string} color - 颜色
     */
    subtitle: function (text, color = 'cyan') {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)

      if (canLog('info')) {
        console.log(prefix + chalk[color](`┌─── ${processedText} ───┐`))
      }

      pinoLogger.info(`--- ${processedText} ---`)
    },

    /**
     * 分隔线
     * @param {string} char - 分隔符字符
     * @param {number} length - 长度
     * @param {string} color - 颜色
     */
    line: function (char = '─', length = 35, color = 'gray') {
      const prefix = createLogPrefix('info')

      if (canLog('info')) {
        console.log(prefix + chalk[color](char.repeat(length)))
      }

      pinoLogger.info(char.repeat(length))
    },

    /**
     * 方框日志
     * @param {string} text - 方框文本
     * @param {string} color - 颜色
     */
    box: function (text, color = 'blue') {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)
      const padding = 2
      const paddedText = ' '.repeat(padding) + processedText + ' '.repeat(padding)
      const line = '─'.repeat(paddedText.length)

      if (canLog('info')) {
        console.log(prefix + chalk[color](`┌${line}┐`))
        console.log(prefix + chalk[color](`│${paddedText}│`))
        console.log(prefix + chalk[color](`└${line}┘`))
      }

      pinoLogger.info(`Box: ${processedText}`)
    },

    /**
     * JSON 日志
     * @param {Object} obj - JSON 对象
     * @param {string} title - 标题
     */
    json: function (obj, title) {
      const prefix = createLogPrefix('info')

      if (title) {
        const processedTitle = ensureUTF8(title)
        if (canLog('info')) {
          console.log(prefix + chalk.cyan(`==== ${processedTitle} ====`))
        }
      }

      try {
        const formatted = JSON.stringify(obj, null, 2)
        if (canLog('info')) {
          const lines = formatted.split('\n')
          lines.forEach((line) => {
            console.log(prefix + chalk.gray(line))
          })
        }
        pinoLogger.info({ data: obj }, title ? `JSON Data [${title}]` : 'JSON Data')
      } catch (err) {
        if (canLog('info')) {
          console.log(prefix + `Cannot serialize object: ${err.message}`)
          console.log(prefix + util.inspect(obj, { depth: null, colors: true }))
        }
        pinoLogger.error({ err }, 'JSON serialization failed')
      }
    },

    /**
     * 进度条
     * @param {number} current - 当前进度
     * @param {number} total - 总数
     * @param {number} length - 进度条长度
     */
    progress: function (current, total, length = 30) {
      const prefix = createLogPrefix('info')
      const percent = Math.min(Math.round((current / total) * 100), 100)
      const filledLength = Math.round((current / total) * length)
      const bar = '█'.repeat(filledLength) + '░'.repeat(length - filledLength)
      const message = `${chalk.cyan('[')}${chalk.green(bar)}${chalk.cyan(']')} ${chalk.yellow(percent + '%')} ${current}/${total}`

      if (canLog('info')) {
        console.log(`${prefix}${message}`)
      }

      if (percent === 100 || percent % 25 === 0) {
        pinoLogger.trace(`Progress: ${percent}% (${current}/${total})`)
      }
    },

    /**
     * 重要日志
     * @param {string} text - 重要消息
     */
    important: function (text) {
      const prefix = createLogPrefix('warn')
      const processedText = ensureUTF8(text)

      if (canLog('warn')) {
        console.log(prefix + chalk.bold.yellow(processedText))
      }

      pinoLogger.warn(`IMPORTANT: ${processedText}`)
    },

    /**
     * 高亮日志
     * @param {string} text - 高亮文本
     */
    highlight: function (text) {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)

      if (canLog('info')) {
        console.log(prefix + chalk.bgYellow.black(processedText))
      }

      pinoLogger.info(`HIGHLIGHT: ${processedText}`)
    },

    /**
     * 失败日志
     * @param {string} text - 失败消息
     */
    fail: function (text) {
      const prefix = createLogPrefix('error')
      const processedText = ensureUTF8(text)

      if (canLog('error')) {
        console.log(prefix + chalk.red(processedText))
      }

      pinoLogger.error(`FAIL: ${processedText}`)
    },

    /**
     * 系统日志
     * @param {string} text - 系统消息
     */
    system: function (text) {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)

      if (canLog('info')) {
        console.log(prefix + chalk.gray(processedText))
      }

      pinoLogger.trace(`System: ${processedText}`)
    },

    /**
     * 列表日志
     * @param {Array} items - 列表项
     * @param {string} title - 标题
     */
    list: function (items, title) {
      const prefix = createLogPrefix('info')

      if (title) {
        const processedTitle = ensureUTF8(title)
        if (canLog('info')) {
          console.log(prefix + chalk.cyan(`=== ${processedTitle} ===`))
        }
        pinoLogger.info(`List: ${processedTitle}`)
      }

      items.forEach((item, index) => {
        const processedItem = ensureUTF8(item)
        const bullet = chalk.gray(`  ${index + 1}.`)
        if (canLog('info')) {
          console.log(prefix + `${bullet} ${processedItem}`)
        }
        pinoLogger.info(`  ${index + 1}. ${processedItem}`)
      })
    },

    /**
     * 状态日志
     * @param {string} message - 消息
     * @param {string} status - 状态
     * @param {string} statusColor - 状态颜色
     */
    status: function (message, status, statusColor = 'green') {
      const prefix = createLogPrefix('info')
      const statusIcons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ',
        pending: '⏳',
        running: '⚙',
        complete: '✓',
        failed: '✗',
        blocked: '⛔',
        skipped: '↷'
      }
      const icon = statusIcons[status.toLowerCase()] || '•'
      const processedMessage = ensureUTF8(message)
      const statusMessage = chalk[statusColor](`${icon} [${status.toUpperCase()}] `) + processedMessage

      if (canLog('info')) {
        console.log(prefix + statusMessage)
      }

      pinoLogger.trace(`Status Change: [${status.toUpperCase()}] ${processedMessage}`)
    },

    /**
     * 标签日志
     * @param {string} text - 文本
     * @param {string} tag - 标签
     * @param {string} tagColor - 标签颜色
     */
    tag: function (text, tag, tagColor = 'blue') {
      const prefix = createLogPrefix('info')
      const processedText = ensureUTF8(text)
      const processedTag = ensureUTF8(tag)
      const taggedMessage = chalk[tagColor](`[${processedTag}] `) + processedText

      if (canLog('info')) {
        console.log(prefix + taggedMessage)
      }

      pinoLogger.info(`[${processedTag}] ${processedText}`)
    },

    /**
     * 表格日志
     * @param {Object} data - 表格数据
     * @param {string} title - 标题
     */
    table: function (data, title) {
      const prefix = createLogPrefix('info')

      if (title) {
        const processedTitle = ensureUTF8(title)
        if (canLog('info')) {
          console.log(prefix + chalk.cyan(`=== ${processedTitle} ===`))
        }
      }

      if (typeof console.table === 'function' && data && typeof data === 'object') {
        if (canLog('info')) {
          console.table(data)
        }
        pinoLogger.trace({ data }, title ? `Table Data [${title}]` : 'Table Data')
      } else {
        this.json(data, title)
      }
    },

    /**
     * 渐变分隔线
     * @param {string} char - 分隔符字符
     * @param {number} length - 长度
     */
    gradientLine: function (char = '─', length = 50) {
      const prefix = createLogPrefix('info')
      const gradientLineText = this.gradient(char.repeat(length))

      if (canLog('info')) {
        console.log(prefix + gradientLineText)
      }

      pinoLogger.info(char.repeat(length))
    },

    /**
     * 获取平台信息
     * @returns {Object} 平台信息
     */
    platform: function () {
      return {
        os: process.platform,
        loggerType: 'pino',
        loggerVersion: '9.x',
        nodeVersion: process.version,
        logLevel: cfg.agt?.logging?.level || 'info',
        logDir: paths.logs || path.join(process.cwd(), 'logs'),
        cleanupSchedule: 'Daily at 3 AM',
        mainLogAge: `${cfg.agt?.logging?.maxDays || LOGGER_CONFIG.DEFAULT_MAX_DAYS} days`,
        traceLogAge: `${cfg.agt?.logging?.traceDays || LOGGER_CONFIG.DEFAULT_TRACE_DAYS} day(s)`,
        logFiles: {
          main: `${LOGGER_CONFIG.MAIN_LOG_PREFIX}.yyyy-MM-dd.log`,
          trace: `${LOGGER_CONFIG.TRACE_LOG_PREFIX}.yyyy-MM-dd.log`
        },
        performance: 'High (Pino)',
        encoding: 'UTF-8'
      }
    },

    /**
     * 手动清理日志
     * @param {number} days - 保留天数
     * @param {boolean} includeTrace - 是否包含 trace 日志
     * @returns {Promise<number>} 删除的文件数
     */
    cleanLogs: async function (days, includeTrace = true) {
      return await cleanExpiredLogs(this, days, includeTrace)
    },

    /**
     * 获取 trace 日志内容
     * @param {number} lines - 行数
     * @returns {Promise<Array|null>} 日志行数组
     */
    getTraceLogs: async function (lines = 100) {
      try {
        const logDir = paths.logs || path.join(process.cwd(), 'logs')
        const currentDate = new Date().toISOString().split('T')[0]
        const traceFile = path.join(logDir, `${LOGGER_CONFIG.TRACE_LOG_PREFIX}.${currentDate}.log`)

        if (!fs.existsSync(traceFile)) {
          return null
        }

        const content = await fsPromises.readFile(traceFile, 'utf8')
        const logLines = content.split('\n').filter((line) => line.trim())

        return logLines.slice(-lines)
      } catch (err) {
        this.error('Failed to read trace logs:', err.message)
        return null
      }
    },

    /**
     * 关闭日志系统
     * @returns {Promise<void>}
     */
    shutdown: async function () {
      try {
        if (cleanupJob) {
          cleanupJob.cancel()
          cleanupJob = null
        }

        await new Promise((resolve) => {
          fileStream.end(() => {
            traceStream.end(() => {
              resolve()
            })
          })
        })

        this.debug('Logger shutdown completed')
      } catch (err) {
        console.error('Error during logger shutdown:', err)
      }
    }
  }

  cleanupJob = schedule.scheduleJob(LOGGER_CONFIG.CLEANUP_TIME, async () => {
    await cleanExpiredLogs(logger)
  })

  setTimeout(() => {
    cleanExpiredLogs(logger).catch(() => {})
  }, 5000)

  process.on('exit', () => {
    if (cleanupJob) {
      cleanupJob.cancel()
    }
    try {
      if (fileStream && typeof fileStream.end === 'function') {
        fileStream.end()
      }
      if (traceStream && typeof traceStream.end === 'function') {
        traceStream.end()
      }
    } catch {}
  })

  const handleShutdown = async () => {
    await logger.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)

  global.logger = logger

  return logger
}


/**
 * 修复 Windows UTF-8 编码问题
 */
function fixWindowsUTF8() {
  if (process.platform === 'win32') {
    try {
      process.stdout.setEncoding('utf8')
      process.stderr.setEncoding('utf8')
      try {
        execSync('chcp 65001', { stdio: 'ignore' })
      } catch {}
    } catch {}
  }
}

/**
 * 简单的文件日志工具（用于日志系统初始化之前）
 * @param {string} logFile - 日志文件路径
 * @param {boolean} silent - 是否静默模式（不输出到控制台）
 * @returns {Object} 日志工具对象
 */
export function createSimpleLogger(logFile, silent = false) {
  const colors = {
    INFO: '\x1b[36m',
    SUCCESS: '\x1b[32m',
    WARNING: '\x1b[33m',
    ERROR: '\x1b[31m',
    RESET: '\x1b[0m'
  }

  async function writeLog(message, level = 'INFO') {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] [${level}] ${message}\n`
    
    try {
      // 确保日志目录存在
      const logDir = path.dirname(logFile)
      await fsPromises.mkdir(logDir, { recursive: true })
      
      // 写入文件
      await fsPromises.appendFile(logFile, logMessage, 'utf8')
      
      // 输出到控制台（除非静默模式）
      if (!silent || level === 'ERROR' || level === 'SUCCESS') {
        const color = colors[level] || ''
        console.log(`${color}${message}${colors.RESET}`)
      }
    } catch (error) {
      // 文件写入失败时，至少输出到控制台
      console.error(`日志写入失败 [${level}]: ${error.message}`)
      if (!silent) {
        console.log(message)
      }
    }
  }

  return {
    log: (message, level = 'INFO') => writeLog(message, level),
    info: (message) => writeLog(message, 'INFO'),
    success: (message) => writeLog(message, 'SUCCESS'),
    warning: (message) => writeLog(message, 'WARNING'),
    error: (message) => writeLog(message, 'ERROR')
  }
}

/**
 * 创建日志轮转流
 * @param {string} logDir - 日志目录路径
 * @param {string} prefix - 文件前缀
 * @param {number} maxDays - 最大保留天数
 * @returns {WritableStream} 轮转流
 */
function createRotatingStream(logDir, prefix, maxDays) {
  return createStream(
    (time) => {
      if (!time) return `${prefix}.log`
      const date = (time instanceof Date ? time : new Date(time)).toISOString().split('T')[0]
      return `${prefix}.${date}.log`
    },
    {
      interval: LOGGER_CONFIG.ROTATION_INTERVAL,
      path: logDir,
      maxFiles: maxDays || LOGGER_CONFIG.DEFAULT_MAX_DAYS,
      compress: false
    }
  )
}

/**
 * 清理过期日志文件
 * @param {Object} logger - Logger 实例
 * @param {number} [customDays] - 自定义保留天数（可选）
 * @param {boolean} [includeTrace=true] - 是否包含 trace 日志
 * @returns {Promise<number>} 删除的文件数
 */
async function cleanExpiredLogs(logger, customDays, includeTrace = true) {
  const logDir = paths.logs || path.join(process.cwd(), 'logs')
  const mainLogMaxAge = customDays || cfg.agt?.logging?.maxDays || LOGGER_CONFIG.DEFAULT_MAX_DAYS
  const traceLogMaxAge = cfg.agt?.logging?.traceDays || LOGGER_CONFIG.DEFAULT_TRACE_DAYS
  const now = Date.now()

  try {
    const files = await fsPromises.readdir(logDir)
    let deletedCount = 0

    for (const file of files) {
      const filePath = path.join(logDir, file)
      const stats = await fsPromises.stat(filePath)

      // 跳过非日志文件（只处理 .log 文件）
      if (!file.endsWith('.log')) continue

      // 删除冗余的 .log.txt 文件（旧代码遗留）
      if (file.endsWith('.log.txt')) {
        try {
          await fsPromises.unlink(filePath)
          deletedCount++
          if (logger) {
            logger.debug(`Deleted redundant log file: ${file}`)
          }
          continue
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (logger) {
            logger.error(`Failed to delete redundant log file: ${file}`, error.message)
          }
          continue
        }
      }

      // 处理正常的日志文件
      let maxAgeMs
      if (file.startsWith(`${LOGGER_CONFIG.TRACE_LOG_PREFIX}.`)) {
        if (!includeTrace) continue
        maxAgeMs = traceLogMaxAge * 24 * 60 * 60 * 1000
      } else if (file === 'bootstrap.log' || file === 'restart.log') {
        // bootstrap.log 和 restart.log 保留更长时间（默认7天）
        maxAgeMs = 7 * 24 * 60 * 60 * 1000
      } else {
        maxAgeMs = mainLogMaxAge * 24 * 60 * 60 * 1000
      }

      if (now - stats.mtime.getTime() > maxAgeMs) {
        try {
          await fsPromises.unlink(filePath)
          deletedCount++
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (logger) {
            logger.error(`Failed to delete log file: ${file}`, error.message)
          }
        }
      }
    }

    if (deletedCount > 0 && logger) {
      logger.debug(`Cleaned ${deletedCount} expired/redundant log files`)
    }
    return deletedCount
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    if (logger) {
      logger.error('Error cleaning expired logs:', error.message)
    }
    return 0
  }
}