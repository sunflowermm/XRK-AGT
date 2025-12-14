import { createRequire } from 'module'
import lodash from 'lodash'
import fs from 'node:fs'
import common from '#utils/common.js'
import { Restart } from './restart.js'

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
    this.xrkPlugins = [
      { name: 'XRK', requiredFiles: ['apps', 'package.json'] },
      { name: 'XRK-Core', requiredFiles: ['index.js'] }
    ]
    this.updatedPlugins = new Set()
  }

  async update() {
    if (!this.e.isMaster) return false
    if (uping) return this.reply('已有命令更新中..请勿重复操作')
    if (/详细|详情|面板|面版/.test(this.e.msg)) return false

    uping = true
    try {
      this.updatedPlugins.clear()
      this.isUp = false
      const plugin = this.getPlugin()
      if (plugin === false) return false

      if (plugin === '') {
        await this.updateMainAndXRK()
      } else {
        await this.runUpdate(plugin)
        this.updatedPlugins.add(plugin)
      }

      if (this.isUp) setTimeout(() => this.restart(), 2000)
    } finally {
      uping = false
    }
  }

  async updateMainAndXRK() {
    await this.runUpdate('')
    this.updatedPlugins.add('main')
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
      if (oldCommitId !== newCommitId) {
        xrkUpdateResults.push(`${plugin.name} 已更新`)
      }
    }
    
    if (xrkUpdateResults.length > 0) {
      await this.reply(`XRK插件更新完成：\n${xrkUpdateResults.join('\n')}`)
    }
  }

  async checkPluginIntegrity(plugin) {
    const pluginPath = `core/${plugin.name}`
    if (!fs.existsSync(pluginPath)) return false
    if (!fs.existsSync(`${pluginPath}/.git`)) return false
    
    const missingFiles = plugin.requiredFiles.filter(file => !fs.existsSync(`${pluginPath}/${file}`))
    if (missingFiles.length > 0) {
      logger.mark(`[更新] ${plugin.name} 目录不完整，跳过更新`)
      return false
    }
    return true
  }

  getPlugin(plugin = '') {
    if (!plugin) {
      plugin = this.e.msg.replace(/#(强制)?更新(日志)?/, '').trim()
      if (!plugin) return ''
    }
    if (!fs.existsSync(`core/${plugin}/.git`)) return false
    this.typeName = plugin
    return plugin
  }

  async execSync(cmd) {
    return new Promise((resolve) => {
      exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr })
      })
    })
  }

  async runUpdate(plugin = '') {
    this.isNowUp = false
    let cm = 'git pull --no-rebase'
    let type = '更新'
    
    if (this.e.msg.includes('强制')) {
      type = '强制更新'
      cm = `git reset --hard && git pull --rebase --allow-unrelated-histories`
    }
    if (plugin) {
      cm = `cd "core/${plugin}" && ${cm}`
    }

    this.oldCommitId = await this.getcommitId(plugin)
    const targetName = plugin || this.typeName
    logger.mark(`${this.e.logFnc} 开始${type}：${targetName}`)
    await this.reply(`开始${type} ${targetName}`)
    
    const ret = await this.execSync(cm)

    if (ret.error) {
      logger.mark(`${this.e.logFnc} 更新失败：${targetName}`)
      await this.gitErr(ret.error, ret.stdout)
      return false
    }

    const time = await this.getTime(plugin)
    const isAlreadyUp = /Already up|已经是最新/g.test(ret.stdout)
    
    if (isAlreadyUp) {
      await this.reply(`${targetName} 已是最新\n最后更新时间：${time}`)
    } else {
      await this.reply(`${targetName} 更新成功\n更新时间：${time}`)
      this.isUp = true
      
      const updateLog = await this.getLog(plugin)
      if (updateLog) {
        await this.reply(updateLog)
      }
    }

    logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
    return true
  }

  async getcommitId(plugin = '') {
    let cm = 'git rev-parse --short HEAD'
    plugin && (cm = `cd "core/${plugin}" && ${cm}`)
    let commitId = ''
    try {
      commitId = execSync(cm, { encoding: 'utf-8' })
    } catch (error) {
      logger.error(`获取commit id失败: ${error}`)
      commitId = ''
    }
    return lodash.trim(commitId)
  }

  async getTime(plugin = '') {
    let cm = 'git log -1 --pretty=%cd --date=format:"%F %T"'
    plugin && (cm = `cd "core/${plugin}" && ${cm}`)
    let time = ''
    try {
      time = execSync(cm, { encoding: 'utf-8' })
    } catch (error) {
      logger.error(error.toString())
      time = '获取时间失败'
    }
    return lodash.trim(time)
  }

  async gitErr(err, stdout) {
    const msg = '更新失败！'
    const errMsg = err.toString()
    const stdoutStr = stdout.toString()

    if (errMsg.includes('Timed out')) {
      const remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, '') || ''
      return this.reply(`${msg}\n连接超时：${remote}`)
    }

    if (/Failed to connect|unable to access/g.test(errMsg)) {
      const remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, '') || ''
      return this.reply(`${msg}\n连接失败：${remote}`)
    }

    if (errMsg.includes('be overwritten by merge')) {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    }

    if (stdoutStr.includes('CONFLICT')) {
      return this.reply(`${msg}\n存在冲突：\n${errMsg}${stdoutStr}\n请解决冲突后再更新，或者执行#强制更新，放弃本地修改`)
    }

    return this.reply(`${msg}\n${errMsg}\n${stdoutStr}`)
  }

  async updateAll() {
    const dirs = fs.readdirSync('./core/')
    const originalReply = this.reply
    this.updatedPlugins.clear()

    const isSilent = /^#静默全部(强制)?更新$/.test(this.e.msg)
    isSilent && (
      await this.reply(`开始执行静默全部更新，请稍等...`),
      this.reply = (message) => {
        this.messages.push(message)
      }
    )

    await this.runUpdate()
    this.updatedPlugins.add('main')

    for (let plu of dirs) {
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

  restart() {
    new Restart(this.e).restart()
  }

  async getLog(plugin = '') {
    let logCmd = 'git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"'
    plugin && (logCmd = `cd "core/${plugin}" && ${logCmd}`)

    let logAll = ''
    try {
      logAll = execSync(logCmd, { encoding: 'utf-8' })
    } catch (error) {
      logger.error(error.toString())
      await this.reply(error.toString())
      return false
    }

    if (!logAll) return false

    const logLines = logAll.trim().split('\n')
    const log = []
    
    for (let str of logLines) {
      str = str.split('||')
      if (str[0] == this.oldCommitId) break
      if (str[1]?.includes('Merge branch')) continue
      log.push(str[1])
    }
    
    const line = log.length
    const logText = log.join('\n\n')
    if (logText.length <= 0) return ''

    let configCmd = 'git config -l'
    plugin && (configCmd = `cd "core/${plugin}" && ${configCmd}`)

    let config = ''
    try {
      config = execSync(configCmd, { encoding: 'utf-8' })
    } catch (error) {
      logger.error(error.toString())
      config = ''
    }
    
    const repoUrl = config
      ?.match(/remote\..*\.url=.+/g)
      ?.join('\n\n')
      ?.replace(/remote\..*\.url=/g, '')
      ?.replace(/\/\/([^@]+)@/, '//') || ''

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