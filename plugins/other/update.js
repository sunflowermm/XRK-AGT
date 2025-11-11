import { createRequire } from 'module'
import lodash from 'lodash'
import fs from 'node:fs'
import { Restart } from './restart.js'
import common from '../../lib/common/common.js'

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

    this.typeName = 'XRK-Yunzai'
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

    /** 清空已更新记录 */
    this.updatedPlugins.clear()
    
    /** 获取指定插件名称 */
    const plugin = this.getPlugin()
    if (plugin === false) return false

    /** 执行更新逻辑 */
    if (plugin === '') {
      /** 更新主程序并自动更新XRK插件 */
      await this.updateMainAndXRK()
    } else {
      /** 更新指定插件 */
      await this.runUpdate(plugin)
      this.updatedPlugins.add(plugin)
    }

    /** 检查是否需要重启 */
    if (this.isUp) {
      setTimeout(() => this.restart(), 2000)
    }
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
      /** 跳过已更新的插件 */
      if (this.updatedPlugins.has(plugin.name)) continue
      
      /** 检查插件是否存在且完整 */
      if (!await this.checkPluginIntegrity(plugin)) continue
      
      logger.mark(`[更新] 检测到 ${plugin.name} 插件，自动更新中...`)
      
      await common.sleep(1500)
      
      /** 记录旧版本 */
      const oldCommitId = await this.getcommitId(plugin.name)
      
      /** 执行更新 */
      await this.runUpdate(plugin.name)
      this.updatedPlugins.add(plugin.name)
      
      /** 检查是否有实际更新 */
      const newCommitId = await this.getcommitId(plugin.name)
      if (oldCommitId !== newCommitId) {
        xrkUpdateResults.push(`${plugin.name} 已更新`)
      }
    }
    
    /** 发送更新结果汇总 */
    if (xrkUpdateResults.length > 0) {
      await this.reply(`XRK插件更新完成：\n${xrkUpdateResults.join('\n')}`)
    }
  }

  /**
   * 检查插件完整性
   * @param {Object} plugin - 插件配置对象
   * @returns {Promise<boolean>} 插件是否完整可用
   */
  async checkPluginIntegrity(plugin) {
    const pluginPath = `plugins/${plugin.name}`
    
    /** 检查目录是否存在 */
    if (!fs.existsSync(pluginPath)) return false
    
    /** 检查是否为git仓库 */
    if (!fs.existsSync(`${pluginPath}/.git`)) return false
    
    /** 检查必需文件是否存在 */
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

    /** 验证插件git仓库是否存在 */
    if (!fs.existsSync(`plugins/${plugin}/.git`)) return false

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

    /** 构建git命令 */
    let cm = 'git pull --no-rebase'
    let type = '更新'
    
    if (this.e.msg.includes('强制')) {
      type = '强制更新'
      cm = `git reset --hard && git pull --rebase --allow-unrelated-histories`
    }
    
    if (plugin) cm = `cd "plugins/${plugin}" && ${cm}`

    /** 记录更新前的commit id */
    this.oldCommitId = await this.getcommitId(plugin)

    /** 开始更新 */
    const targetName = plugin || this.typeName
    logger.mark(`${this.e.logFnc} 开始${type}：${targetName}`)
    await this.reply(`开始${type} ${targetName}`)
    
    uping = true
    const ret = await this.execSync(cm)
    uping = false

    /** 处理更新错误 */
    if (ret.error) {
      logger.mark(`${this.e.logFnc} 更新失败：${targetName}`)
      this.gitErr(ret.error, ret.stdout)
      return false
    }

    /** 获取更新时间 */
    const time = await this.getTime(plugin)

    /** 判断是否有更新 */
    if (/Already up|已经是最新/g.test(ret.stdout)) {
      await this.reply(`${targetName} 已是最新\n最后更新时间：${time}`)
    } else {
      await this.reply(`${targetName} 更新成功\n更新时间：${time}`)
      this.isUp = true
      
      /** 获取并发送更新日志 */
      const updateLog = await this.getLog(plugin)
      if (updateLog) {
        await this.reply(updateLog)
      }
    }

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
    if (plugin) cm = `cd "plugins/${plugin}" && ${cm}`

    try {
      const commitId = await execSync(cm, { encoding: 'utf-8' })
      return lodash.trim(commitId)
    } catch (error) {
      logger.error(`获取commit id失败: ${error}`)
      return ''
    }
  }

  /**
   * 获取最后更新时间
   * @param {string} plugin - 插件名称
   * @returns {Promise<string>} 更新时间
   */
  async getTime(plugin = '') {
    let cm = 'git log -1 --pretty=%cd --date=format:"%F %T"'
    if (plugin) cm = `cd "plugins/${plugin}" && ${cm}`

    try {
      const time = await execSync(cm, { encoding: 'utf-8' })
      return lodash.trim(time)
    } catch (error) {
      logger.error(error.toString())
      return '获取时间失败'
    }
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

    /** 连接超时 */
    if (errMsg.includes('Timed out')) {
      const remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
      return this.reply(`${msg}\n连接超时：${remote}`)
    }

    /** 连接失败 */
    if (/Failed to connect|unable to access/g.test(errMsg)) {
      const remote = errMsg.match(/'(.+?)'/g)[0].replace(/'/g, '')
      return this.reply(`${msg}\n连接失败：${remote}`)
    }

    /** 存在冲突 */
    if (errMsg.includes('be overwritten by merge')) {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    }

    if (stdout.includes('CONFLICT')) {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}${stdout}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    }

    return this.reply([errMsg, stdout])
  }

  /**
   * 更新所有插件
   * @returns {Promise<void>}
   */
  async updateAll() {
    const dirs = fs.readdirSync('./plugins/')
    const originalReply = this.reply
    
    /** 清空已更新记录 */
    this.updatedPlugins.clear()

    /** 判断是否静默更新 */
    const isSilent = /^#静默全部(强制)?更新$/.test(this.e.msg)
    if (isSilent) {
      await this.reply(`开始执行静默全部更新，请稍等...`)
      this.reply = (message) => {
        this.messages.push(message)
      }
    }

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

    /** 发送静默更新结果 */
    if (isSilent) {
      this.reply = originalReply
      await this.reply(await common.makeForwardMsg(this.e, this.messages))
    }

    /** 检查是否需要重启 */
    if (this.isUp) {
      setTimeout(() => this.restart(), 2000)
    }
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
    let cm = 'git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"'
    if (plugin) cm = `cd "plugins/${plugin}" && ${cm}`

    let logAll
    try {
      logAll = await execSync(cm, { encoding: 'utf-8' })
    } catch (error) {
      logger.error(error.toString())
      await this.reply(error.toString())
      return false
    }

    if (!logAll) return false

    /** 解析日志 */
    logAll = logAll.trim().split('\n')
    let log = []
    
    for (let str of logAll) {
      str = str.split('||')
      if (str[0] == this.oldCommitId) break
      if (str[1].includes('Merge branch')) continue
      log.push(str[1])
    }
    
    const line = log.length
    log = log.join('\n\n')

    if (log.length <= 0) return ''

    /** 获取仓库地址 */
    let repoUrl = ''
    try {
      cm = 'git config -l'
      if (plugin) cm = `cd "plugins/${plugin}" && ${cm}`
      
      const config = await execSync(cm, { encoding: 'utf-8' })
      repoUrl = config
        .match(/remote\..*\.url=.+/g)
        .join('\n\n')
        .replace(/remote\..*\.url=/g, '')
        .replace(/\/\/([^@]+)@/, '//')
    } catch (error) {
      logger.error(error.toString())
    }

    return common.makeForwardMsg(
      this.e, 
      [log, repoUrl], 
      `${plugin || 'XRK-Yunzai'} 更新日志，共${line}条`
    )
  }

  /**
   * 查看更新日志
   * @returns {Promise<void>}
   */
  async updateLog() {
    const plugin = this.getPlugin()
    if (plugin === false) return false
    return this.reply(await this.getLog(plugin))
  }
}