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
          reg: '^#(强制)?更新(?:\\s*(.*))?$',
          fnc: 'update'
        },
        {
          reg: '^#(静默)?全部(强制)?更新$',
          fnc: 'updateAll',
          permission: 'master'
        },
        {
          reg: '^#(?:更新|查看)?日志(?:\\s*(.*))?$',
          fnc: 'updateLog'
        }
      ]
    })
  }

  async update() {
    if (!this.e.isMaster) return false
    if (uping) {
      await this.reply('已有命令更新中..请勿重复操作')
      return false
    }
    if (/详细|详情|面板|面版/.test(this.e.msg)) return false

    uping = true
    const updatedTargets = new Set()
    let isUp = false
    let oldCommitId = null
    
    try {
      const targetName = (this.e.msg.replace(/#(强制)?更新/, '').trim()) || ''

      if (targetName) {
        // 更新指定 Core
        if (!this.isValidGitCore(targetName)) {
          await this.reply(`指定的 Core 目录 ${targetName} 不存在或不是有效的 git 仓库`)
          return false
        }
        const result = await this.runUpdate(targetName, oldCommitId)
        if (result) {
          updatedTargets.add(targetName)
          isUp = true
        }
      } else {
        // 更新整个项目
        const result = await this.runUpdate('', oldCommitId)
        if (result) {
          updatedTargets.add('project-root')
          isUp = true
        }
      }

      if (isUp) {
        setTimeout(() => this.restart(), 2000)
      }
    } catch (error) {
      logger.error(`更新失败: ${error.message}`, error)
      await this.reply(`更新失败: ${error.message}`)
      return false
    } finally {
      uping = false
    }
    
    return true
  }



  async runUpdate(coreName = '', oldCommitId = null) {
    const isProjectUpdate = !coreName
    const targetPath = isProjectUpdate ? '.' : `./core/${coreName}`
    const targetDisplayName = isProjectUpdate ? 'XRK-AGT 项目' : coreName
    const isForce = this.e.msg.includes('强制')
    const type = isForce ? '强制更新' : '更新'
    const cm = isForce 
      ? `git reset --hard && git pull --rebase --allow-unrelated-histories`
      : 'git pull --no-rebase'

    const currentOldCommitId = oldCommitId || await this.getCommitId(targetPath)
    logger.mark(`${this.e.logFnc} 开始${type}：${targetDisplayName}`)
    await this.reply(`开始${type} ${targetDisplayName}`)

    try {
      const stdout = execSync(cm, { cwd: targetPath, encoding: 'utf-8', windowsHide: true })
      const time = await this.getTime(targetPath)
      
      if (/Already up|已经是最新/g.test(stdout)) {
        await this.reply(`${targetDisplayName} 已是最新\n最后更新时间：${time}`)
        return false
      } else {
        await this.reply(`${targetDisplayName} 更新成功\n更新时间：${time}`)
        const updateLog = await this.getLog(targetPath, targetDisplayName, currentOldCommitId)
        if (updateLog) {
          await this.reply(updateLog)
        }
        logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
        return true
      }
    } catch (error) {
      logger.error(`${this.e.logFnc} 更新失败：${targetDisplayName}`, error)
      await this.handleGitError(error, error.stdout || error.stderr || '')
      return false
    }
  }



  async getCommitId(cwd = '.') {
    try {
      return lodash.trim(execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8', windowsHide: true }))
    } catch (error) {
      logger.error(`获取 commit ID 失败 [${cwd}]:`, error)
      return 'unknown'
    }
  }

  async getTime(cwd = '.') {
    try {
      return lodash.trim(execSync('git log -1 --pretty=%cd --date=format:"%F %T"', {
        cwd,
        encoding: 'utf-8',
        windowsHide: true
      })) || '获取时间失败'
    } catch (error) {
      logger.error(`获取时间失败 [${cwd}]:`, error)
      return '获取时间失败'
    }
  }

  async handleGitError(err, stdout) {
    const msg = '更新失败！'
    const errMsg = err?.message || String(err)
    const stdoutStr = String(stdout || '')
    const errorMap = [
      {
        test: /Timed out|timeout/i,
        message: (msg) => `${msg}\n连接超时：${this.extractRemoteUrl(errMsg)}`
      },
      {
        test: /Failed to connect|unable to access|Could not read from remote/i,
        message: (msg) => `${msg}\n连接失败：${this.extractRemoteUrl(errMsg)}`
      },
      {
        test: /be overwritten by merge|CONFLICT/i,
        message: (msg) => `${msg}\n存在冲突，请解决冲突后再更新，或者执行#强制更新，放弃本地修改`
      }
    ]

    const matchedError = errorMap.find(e => e.test.test(errMsg) || e.test.test(stdoutStr))
    const errorMessage = matchedError ? matchedError.message(msg) : `${msg}\n${errMsg}${stdoutStr ? '\n' + stdoutStr : ''}`
    await this.reply(errorMessage)
  }

  extractRemoteUrl(str) {
    return (str.match(/'([^']+)'/g) || []).pop()?.replace(/'/g, '') || '未知地址'
  }

  isValidGitCore(coreName) {
    if (!coreName) return false
    const corePath = `core/${coreName}`
    return fs.existsSync(corePath) && 
           fs.statSync(corePath).isDirectory() && 
           fs.existsSync(`${corePath}/.git`)
  }

  async updateAll() {
    if (!this.e.isMaster) return false
    
    const updatedTargets = new Set()
    const messages = []
    let isUp = false
    let oldCommitId = null

    const isSilent = /^#静默全部(强制)?更新$/.test(this.e.msg)
    const originalReply = this.reply
    if (isSilent) {
      await this.reply(`开始执行静默全部更新，请稍等...`)
      this.reply = (message) => {
        messages.push(message)
      }
    }

    try {
      const coreDir = './core'
      if (fs.existsSync(coreDir)) {
        const coreSubdirs = fs.readdirSync(coreDir)
        for (const subdir of coreSubdirs) {
          if (updatedTargets.has(subdir)) continue
          if (!this.isValidGitCore(subdir)) continue
          
          await common.sleep(1500)
          const result = await this.runUpdate(subdir, oldCommitId)
          if (result) {
            updatedTargets.add(subdir)
            isUp = true
          }
        }
      }
      
      // 最后更新项目根目录
      if (!updatedTargets.has('project-root')) {
        const result = await this.runUpdate('', oldCommitId)
        if (result) {
          updatedTargets.add('project-root')
          isUp = true
        }
      }
    } catch (error) {
      logger.error(`检查core目录失败: ${error.message}`, error)
      if (!isSilent) {
        await this.reply(`更新过程中出错: ${error.message}`)
      }
    } finally {
      if (isSilent) {
        this.reply = originalReply
        if (messages.length > 0) {
          await this.reply(await common.makeForwardMsg(this.e, messages))
        }
      }
    }

    if (isUp) {
      setTimeout(() => this.restart(), 2000)
    }
    
    return true
  }

  restart() {
    new Restart(this.e).restart()
  }

  async getLog(cwd = '.', displayName = '', oldCommitId = null) {
    try {
      // 获取最近的100条提交日志
      const logAll = execSync(
        'git log -100 --pretty="%h||[%cd] %s" --date=format:\"%F %T\"',
        { cwd, encoding: 'utf-8', windowsHide: true }
      )

      if (!logAll) return false

      // 处理日志行，过滤掉合并提交
      const logLines = logAll.trim().split('\n')
      const log = []
      
      for (let str of logLines) {
        const parts = str.split('||')
        if (oldCommitId && parts[0] === oldCommitId) break
        if (parts[1]?.includes('Merge branch')) continue
        log.push(parts[1])
      }
      
      const line = log.length
      const logText = log.join('\n\n')
      if (logText.length <= 0) return ''

      // 获取仓库URL
      let repoUrl = ''
      try {
        const config = execSync('git config -l', { cwd, encoding: 'utf-8', windowsHide: true })
        repoUrl = config
          ?.match(/remote\..*\.url=.+/g)
          ?.map(url => url.replace(/remote\..*\.url=/, '').replace(/\/\/([^@]+)@/, '//'))
          .join('\n\n') || ''
      } catch (error) {
        logger.error('获取仓库URL失败:', error)
      }

      return common.makeForwardMsg(
        this.e, 
        [logText, repoUrl].filter(Boolean), 
        `${displayName} 更新日志，共${line}条`
      )
    } catch (error) {
      logger.error('获取更新日志失败:', error)
      return `获取更新日志失败: ${error.message}`
    }
  }

  async updateLog() {
    const targetName = (this.e.msg.replace(/#(?:更新|查看)?日志/, '').trim()) || ''
    
    if (targetName) {
      if (!this.isValidGitCore(targetName)) {
        await this.reply(`指定的 Core 目录 ${targetName} 不存在或不是有效的 git 仓库`)
        return false
      }
      return this.reply(await this.getLog(`./core/${targetName}`, targetName))
    }
    
    return this.reply(await this.getLog('.', 'XRK-AGT 项目'))
  }
}