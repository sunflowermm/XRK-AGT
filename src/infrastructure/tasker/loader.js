import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import paths from '#utils/paths.js'
import BotUtil from '#utils/botutil.js'

// Tasker 加载器
class TaskerLoader {
  constructor() {
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
      const files = []
      const coreDirs = await paths.getCoreDirs()
      
      for (const coreDir of coreDirs) {
        const taskerDir = path.join(coreDir, 'tasker')
        if (!existsSync(taskerDir)) continue
        
        try {
          const { FileLoader } = await import('#utils/file-loader.js');
          const taskerFiles = await FileLoader.readFiles(taskerDir, {
            ext: '.js',
            recursive: false,
            ignore: ['.', '_']
          });
          for (const filePath of taskerFiles) {
            files.push({
              name: path.basename(filePath),
              href: pathToFileURL(filePath).href,
              core: path.basename(coreDir)
            });
          }
        } catch (error) {
          BotUtil.makeLog('warn', `读取 tasker 目录失败: ${taskerDir}`, this.loggerNs);
        }
      }
      
      return files
    } catch (error) {
      BotUtil.makeLog('error', `获取 tasker 文件列表失败`, this.loggerNs, error)
      return []
    }
  }
}

export default new TaskerLoader()

