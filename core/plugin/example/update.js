import { createRequire } from 'module'
import lodash from 'lodash'
import fs from 'node:fs'
import { Restart } from './restart.js'
import common from '../../../src/utils/common.js'

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')

let uping = false

export class update extends plugin {
  constructor() {
    super({
      name: '更新',
      dsc: '#更新 #强制更新',
      event: 'message',
      priority: 4000,
      rule: [
        {
          reg: '^#更新日志',
          fnc: 'updateLog'
        },
        {
          reg: '^#(强制)?更新',
          fnc: 'update'
        },
        {
          reg: '^#(静默)?全部(强制)?更新$',
          fnc: 'updateAll',
          permission: 'master'
        }
      ]
    })

    this.typeName = 'XRK-AGT'
    this.messages = []
    
    /** XRK相关插件配置 */
    this.xrkPlugins = [
      { name: 'XRK', requiredFiles: ['apps', 'package.json'] },
      { name: 'XRK-Core', requiredFiles: ['index.js'] }
    ]
    
    /** 记录已更新的插件，避免重复 */
    this.updatedPlugins = new Set()
  }

  /**
   * 主更新方法
   * @returns {Promise<boolean>}
   */
  async update() {
    if (!this.e.isMaster) return false
    if (uping) return this.reply('已有命令更新中..请勿重复操作')
    if (/详细|详情|面板|面版/.test(this.e.msg)) return false

    this.updatedPlugins.clear()
    
    const plugin = this.getPlugin()
    if (plugin === false) return false

    plugin === '' ? await this.updateMainAndXRK() : (
      await this.runUpdate(plugin),
      this.updatedPlugins.add(plugin)
    )

    this.isUp && setTimeout(() => this.restart(), 2000)
  }

  /**
   * 更新主程序和XRK相关插件
   * @returns {Promise<void>}
   */
  async updateMainAndXRK() {
    /** 更新主程序 */
    await this.runUpdate('')
    this.updatedPlugins.add('main')
    
    /** 延迟1秒后检查并更新XRK插件 */
    await common.sleep(1000)
    
    const xrkUpdateResults = []
    
    for (const plugin of this.xrkPlugins) {
      if (this.updatedPlugins.has(plugin.name)) continue
      if (!await this.checkPluginIntegrity(plugin)) continue
      
      logger.mark(`[更新] 检测到 ${plugin.name} 插件，自动更新中...`)
      await common.sleep(1500)
      
      const oldCommitId = await this.getcommitId(plugin.name)
      await this.runUpdate(plugin.name)
      this.updatedPlugins.add(plugin.name)
      
      const newCommitId = await this.getcommitId(plugin.name)
      oldCommitId !== newCommitId && xrkUpdateResults.push(`${plugin.name} 已更新`)
    }
    
    xrkUpdateResults.length > 0 && await this.reply(`XRK插件更新完成：\n${xrkUpdateResults.join('\n')}`)
  }

  /**
   * 检查插件完整性
   * @param {Object} plugin - 插件配置对象
   * @returns {Promise<boolean>} 插件是否完整可用
   */
  async checkPluginIntegrity(plugin) {
    const pluginPath = `core/${plugin.name}`
    
    if (!fs.existsSync(pluginPath)) return false
    if (!fs.existsSync(`${pluginPath}/.git`)) return false
    
    const isComplete = plugin.requiredFiles.every(file => 
      fs.existsSync(`${pluginPath}/${file}`)
    )
    
    if (!isComplete) {
      logger.mark(`[更新] ${plugin.name} 目录不完整，跳过更新`)
      return false
    }
    
    return true
  }

  /**
   * 获取插件名称
   * @param {string} plugin - 插件名称
   * @returns {string|boolean} 插件名称或false
   */
  getPlugin(plugin = '') {
    if (!plugin) {
      plugin = this.e.msg.replace(/#(强制)?更新(日志)?/, '').trim()
      if (!plugin) return ''
    }

    if (!fs.existsSync(`core/${plugin}/.git`)) return false

    this.typeName = plugin
    return plugin
  }

  /**
   * 异步执行shell命令
   * @param {string} cmd - 命令
   * @returns {Promise<Object>} 执行结果
   */
  async execSync(cmd) {
    return new Promise((resolve) => {
      exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr })
      })
    })
  }

  /**
   * 执行更新操作
   * @param {string} plugin - 插件名称，空字符串表示更新主程序
   * @returns {Promise<boolean>} 更新是否成功
   */
  async runUpdate(plugin = '') {
    this.isNowUp = false

    let cm = 'git pull --no-rebase'
    let type = '更新'
    
    this.e.msg.includes('强制') && (
      type = '强制更新',
      cm = `git reset --hard && git pull --rebase --allow-unrelated-histories`
    )
    
    plugin && (cm = `cd "core/${plugin}" && ${cm}`)

    /** 记录更新前的commit id */
    this.oldCommitId = await this.getcommitId(plugin)

    /** 开始更新 */
    const targetName = plugin || this.typeName
    logger.mark(`${this.e.logFnc} 开始${type}：${targetName}`)
    await this.reply(`开始${type} ${targetName}`)
    
    uping = true
    const ret = await this.execSync(cm)
    uping = false

    ret.error && (
      logger.mark(`${this.e.logFnc} 更新失败：${targetName}`),
      this.gitErr(ret.error, ret.stdout),
      (() => { return false })()
    )

    const time = await this.getTime(plugin)

    const isAlreadyUp = /Already up|已经是最新/g.test(ret.stdout)
    isAlreadyUp ? 
      await this.reply(`${targetName} 已是最新\n最后更新时间：${time}`) :
      (
        await this.reply(`${targetName} 更新成功\n更新时间：${time}`),
        this.isUp = true,
        (async () => {
          const updateLog = await this.getLog(plugin)
          updateLog && await this.reply(updateLog)
        })()
      )

    logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
    return true
  }

  /**
   * 获取git commit id
   * @param {string} plugin - 插件名称
   * @returns {Promise<string>} commit id
   */
  async getcommitId(plugin = '') {
    let cm = 'git rev-parse --short HEAD'
    plugin && (cm = `cd "core/${plugin}" && ${cm}`)

    const commitId = await execSync(cm, { encoding: 'utf-8' }).catch(error => {
      logger.error(`获取commit id失败: ${error}`)
      return ''
    })
    return lodash.trim(commitId)
  }

  /**
   * 获取最后更新时间
   * @param {string} plugin - 插件名称
   * @returns {Promise<string>} 更新时间
   */
  async getTime(plugin = '') {
    let cm = 'git log -1 --pretty=%cd --date=format:"%F %T"'
    plugin && (cm = `cd "core/${plugin}" && ${cm}`)

    const time = await execSync(cm, { encoding: 'utf-8' }).catch(error => {
      logger.error(error.toString())
      return '获取时间失败'
    })
    return lodash.trim(time)
  }

  /**
   * 处理git错误
   * @param {Error} err - 错误对象
   * @param {string} stdout - 标准输出
   * @returns {Promise<void>}
   */
  async gitErr(err, stdout) {
    const msg = '更新失败！'
    const errMsg = err.toString()
    stdout = stdout.toString()

    errMsg.includes('Timed out') && (() => {
      const remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
      return this.reply(`${msg}\n连接超时：${remote}`)
    })()

    const connectionFailed = /Failed to connect|unable to access/g.test(errMsg)
    connectionFailed && (() => {
      const remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
      return this.reply(`${msg}\n连接失败：${remote}`)
    })()

    errMsg.includes('be overwritten by merge') && (() => {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    })()

    stdout.includes('CONFLICT') && (() => {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}${stdout}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    })()

    return this.reply([errMsg, stdout])
  }

  /**
   * 更新所有插件
   * @returns {Promise<void>}
   */
  async updateAll() {
    const dirs = fs.readdirSync('./core/')
    const originalReply = this.reply
    
    /** 清空已更新记录 */
    this.updatedPlugins.clear()

    const isSilent = /^#静默全部(强制)?更新$/.test(this.e.msg)
    isSilent && (
      await this.reply(`开始执行静默全部更新，请稍等...`),
      this.reply = (message) => {
        this.messages.push(message)
      }
    )

    /** 更新主程序 */
    await this.runUpdate()
    this.updatedPlugins.add('main')

    /** 更新所有插件 */
    for (let plu of dirs) {
      /** 跳过已更新的插件 */
      if (this.updatedPlugins.has(plu)) continue
      
      plu = this.getPlugin(plu)
      if (plu === false) continue
      
      await common.sleep(1500)
      await this.runUpdate(plu)
      this.updatedPlugins.add(plu)
    }

    isSilent && (
      this.reply = originalReply,
      await this.reply(await common.makeForwardMsg(this.e, this.messages))
    )

    this.isUp && setTimeout(() => this.restart(), 2000)
  }

  /**
   * 重启应用
   */
  restart() {
    new Restart(this.e).restart()
  }

  /**
   * 获取更新日志
   * @param {string} plugin - 插件名称
   * @returns {Promise<string|boolean>} 更新日志
   */
  async getLog(plugin = '') {
    let logCmd = 'git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"'
    plugin && (logCmd = `cd "core/${plugin}" && ${logCmd}`)

    const logAll = await execSync(logCmd, { encoding: 'utf-8' }).catch(async error => {
      logger.error(error.toString())
      await this.reply(error.toString())
      return false
    })

    !logAll && (() => { return false })()

    const logLines = logAll.trim().split('\n')
    const log = []
    
    for (let str of logLines) {
      str = str.split('||')
      if (str[0] == this.oldCommitId) break
      if (str[1].includes('Merge branch')) continue
      log.push(str[1])
    }
    
    const line = log.length
    const logText = log.join('\n\n')

    if (logText.length <= 0) return ''

    let configCmd = 'git config -l'
    plugin && (configCmd = `cd "core/${plugin}" && ${configCmd}`)
    
    const config = await execSync(configCmd, { encoding: 'utf-8' }).catch(error => {
      logger.error(error.toString())
      return ''
    })
    
    const repoUrl = config
      .match(/remote\..*\.url=.+/g)
      .join('\n\n')
      .replace(/remote\..*\.url=/g, '')
      .replace(/\/\/([^@]+)@/, '//')

    return common.makeForwardMsg(
      this.e, 
      [logText, repoUrl], 
      `${plugin || 'XRK-AGT'} 更新日志，共${line}条`
    )
  }

  async updateLog() {
    const plugin = this.getPlugin()
    if (plugin === false) return false
    return this.reply(await this.getLog(plugin))
  }
}