import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec, execSync } from 'child_process'
import common from '../../lib/common/common.js'

const execAsync = promisify(exec)

let updateLogs = []
export class example2 extends plugin {
  constructor() {
    super({
      name: '向日葵妈咪妈咪哄',
      dsc: '自动克隆或更新XRK和XRK-Core仓库',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^(#)?向日葵妈咪妈咪哄$',
          fnc: 'handleXRK',
          permission: 'master'
        }
      ]
    })
  }

  async handleXRK() {
    const pluginsPath = path.join(process.cwd(), 'plugins')
    const repos = [
      {
        name: 'XRK',
        url: 'https://gitcode.com/Xrkseek/XRK',
        requiredFiles: ['apps', 'package.json']
      },
      {
        name: 'XRK-Core',
        url: 'https://gitcode.com/Xrkseek/XRK-Core',
        requiredFiles: ['index.js']
      }
    ]

    await this.reply('🌻 开始处理XRK仓库...', false, { at: true })
    
    const results = []
    updateLogs = []
    
    for (const repo of repos) {
      try {
        const result = await this.processRepo(pluginsPath, repo)
        results.push(result)
      } catch (error) {
        results.push(`❌ ${repo.name}: ${error.message}`)
        logger.error(`[XRK] 处理 ${repo.name} 时出错:`, error)
      }
    }

    const summary = results.join('\n')
    await this.reply(`处理完成！\n${summary}`, false, { at: true })
    
    if (updateLogs.length > 0) {
      const forwardMsg = await common.makeForwardMsg(this.e, updateLogs, 'XRK仓库更新日志')
      await this.reply(forwardMsg)
    }
  }

  async processRepo(pluginsPath, repo) {
    const repoPath = path.join(pluginsPath, repo.name)
    
    if (fs.existsSync(repoPath)) {
      const isComplete = this.checkRepoCompleteness(repoPath, repo.requiredFiles)
      
      if (!isComplete) {
        logger.info(`[XRK] ${repo.name} 目录不完整，重新克隆...`)
        await this.removeDirectory(repoPath)
        return await this.cloneRepo(pluginsPath, repo)
      } else {
        return await this.updateRepo(repoPath, repo)
      }
    } else {
      return await this.cloneRepo(pluginsPath, repo)
    }
  }

  checkRepoCompleteness(repoPath, requiredFiles) {
    return requiredFiles.every(file => 
      fs.existsSync(path.join(repoPath, file))
    )
  }

  async getCommitId(repoPath) {
    try {
      const commitId = execSync('git rev-parse --short HEAD', {
        cwd: repoPath,
        encoding: 'utf-8'
      })
      return commitId.trim()
    } catch (error) {
      return null
    }
  }

  async getUpdateLog(repoPath, oldCommitId, repoName) {
    try {
      const logCmd = 'git log -100 --pretty="%h||[%cd] %s" --date=format:"%F %T"'
      const logAll = execSync(logCmd, {
        cwd: repoPath,
        encoding: 'utf-8'
      })

      if (!logAll) return null

      const logs = logAll.trim().split('\n')
      const updateLogs = []
      
      for (let str of logs) {
        const [commitId, message] = str.split('||')
        if (commitId === oldCommitId) break
        if (message && !message.includes('Merge branch')) {
          updateLogs.push(message)
        }
      }

      if (updateLogs.length === 0) return null

      const logMessage = `${repoName} 更新内容（共${updateLogs.length}条）：\n\n${updateLogs.join('\n\n')}`
      return logMessage
    } catch (error) {
      logger.error(`[XRK] 获取更新日志失败:`, error)
      return null
    }
  }

  async getUpdateTime(repoPath) {
    try {
      const time = execSync('git log -1 --pretty=%cd --date=format:"%F %T"', {
        cwd: repoPath,
        encoding: 'utf-8'
      })
      return time.trim()
    } catch (error) {
      return '获取时间失败'
    }
  }

  async cloneRepo(pluginsPath, repo) {
    return new Promise((resolve, reject) => {
      const args = ['clone', '--progress', repo.url, repo.name]
      const git = spawn('git', args, {
        cwd: pluginsPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      let progressData = ''
      
      git.stderr.on('data', (data) => {
        const output = data.toString()
        process.stderr.write(output)
        progressData += output
      })

      git.stdout.on('data', (data) => {
        process.stdout.write(data.toString())
      })

      git.on('close', async (code) => {
        if (code === 0) {
          logger.info(`[XRK] 成功克隆 ${repo.name}`)
          const repoPath = path.join(pluginsPath, repo.name)
          const time = await this.getUpdateTime(repoPath)
          const logMsg = `✅ ${repo.name}: 克隆成功\n更新时间：${time}`
          
          resolve(logMsg)
        } else {
          reject(new Error(`克隆失败，退出码: ${code}`))
        }
      })

      git.on('error', (err) => {
        reject(new Error(`无法启动git: ${err.message}`))
      })
    })
  }

  async updateRepo(repoPath, repo) {
    const oldCommitId = await this.getCommitId(repoPath)
    
    return new Promise((resolve, reject) => {
      const git = spawn('git', ['pull', '--progress'], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe']
      })

      let output = ''
      let errorOutput = ''

      git.stdout.on('data', (data) => {
        const str = data.toString()
        output += str
        process.stdout.write(str)
      })

      git.stderr.on('data', (data) => {
        const str = data.toString()
        errorOutput += str
        process.stderr.write(str)
      })

      git.on('close', async (code) => {
        if (code === 0) {
          const time = await this.getUpdateTime(repoPath)
          
          if (output.includes('Already up to date') || errorOutput.includes('Already up to date')) {
            resolve(`📌 ${repo.name}: 已是最新版本\n最后更新时间：${time}`)
          } else {
            const newCommitId = await this.getCommitId(repoPath)
            
            if (oldCommitId && newCommitId && oldCommitId !== newCommitId) {
              const updateLog = await this.getUpdateLog(repoPath, oldCommitId, repo.name)
              if (updateLog) {
                updateLogs.push(updateLog)
              }
            }
            
            resolve(`✅ ${repo.name}: 更新成功\n更新时间：${time}`)
          }
        } else {
          reject(new Error(`更新失败，退出码: ${code}`))
        }
      })

      git.on('error', (err) => {
        reject(new Error(`无法启动git: ${err.message}`))
      })
    })
  }

  async removeDirectory(dirPath) {
    try {
      if (fs.existsSync(dirPath)) {
        await fs.promises.rm(dirPath, { recursive: true, force: true })
      }
    } catch (error) {
      try {
        const isWindows = process.platform === 'win32'
        const command = isWindows 
          ? `rmdir /s /q "${dirPath}"`
          : `rm -rf "${dirPath}"`
        await execAsync(command)
      } catch (cmdError) {
        logger.error(`[XRK] 删除目录失败: ${dirPath}`, cmdError)
        throw new Error(`无法删除目录: ${cmdError.message}`)
      }
    }
  }
}