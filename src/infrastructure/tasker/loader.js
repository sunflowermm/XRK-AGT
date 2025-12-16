import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import paths from '#utils/paths.js'
import BotUtil from '#utils/botutil.js'

// Tasker 加载器
class TaskerLoader {
  constructor() {
    this.baseDir = paths.coreTasker
    this.loggerNs = 'TaskerLoader'
  }

  async load(bot = Bot) {
    const summary = {
      scanned: 0,
      loaded: 0,
      failed: 0,
      registered: 0,
      errors: []
    }

    try {
      const files = await this.getAdapterFiles()
      summary.scanned = files.length

      if (!files.length) {
        BotUtil.makeLog('info', '未找到 tasker 文件', this.loggerNs)
        return summary
      }

      const adapterCountBefore = bot?.tasker?.length ?? 0

      await Promise.allSettled(
        files.map(async ({ name, href }) => {
          try {
            BotUtil.makeLog('debug', `导入 tasker 文件: ${name}`, this.loggerNs)
            await import(href)
            summary.loaded += 1
          } catch (err) {
            summary.failed += 1
            summary.errors.push({ name, message: err.message })
            BotUtil.makeLog('error', `导入 tasker 失败: ${name}`, this.loggerNs, err)
          }
        })
      )

      summary.registered = (bot?.tasker?.length ?? 0) - adapterCountBefore

      BotUtil.makeLog(
        summary.failed ? 'warn' : 'info',
        `Tasker 加载完成: 成功${summary.loaded}个, 注册${summary.registered}个${summary.failed ? `, 失败${summary.failed}个` : ''}`,
        this.loggerNs
      )

      return summary
    } catch (error) {
      BotUtil.makeLog('error', 'Tasker 加载失败', this.loggerNs, error)
      summary.failed += 1
      summary.errors.push({ name: 'internal', message: error.message })
      return summary
    }
  }

  async getAdapterFiles() {
    try {
      const dirents = await fs.readdir(this.baseDir, { withFileTypes: true })
      return dirents
        .filter(dirent => dirent.isFile() && dirent.name.endsWith('.js'))
        .map(dirent => ({
          name: dirent.name,
          href: pathToFileURL(path.join(this.baseDir, dirent.name)).href
        }))
    } catch (error) {
      if (error.code === 'ENOENT') {
        BotUtil.makeLog('warn', `Tasker 目录不存在: ${this.baseDir}`, this.loggerNs)
        return []
      }
      throw error
    }
  }
}

export default new TaskerLoader()

