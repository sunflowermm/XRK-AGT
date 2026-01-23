/**
 * 统一热更新基类
 * 提供通用的文件监视和热更新功能，减少重复代码
 */
import chokidar from 'chokidar'
import lodash from 'lodash'
import path from 'path'
import BotUtil from '#utils/botutil.js'
import paths from '#utils/paths.js'

export class HotReloadBase {
  constructor(options = {}) {
    this.watcher = null
    this.loggerName = options.loggerName || 'HotReload'
    this.debounceDelay = options.debounceDelay || 500
    this.awaitWriteFinish = options.awaitWriteFinish || {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  }

  /**
   * 检查文件是否有效
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  isValidFile(filePath) {
    const fileName = path.basename(filePath)
    return fileName.endsWith('.js') && 
           !fileName.startsWith('.') && 
           !fileName.startsWith('_')
  }

  /**
   * 启用文件监视
   * @param {boolean} enable - 是否启用
   * @param {Object} options - 配置选项
   * @param {string|Array} options.dirs - 要监视的目录（或目录数组）
   * @param {Function} options.onAdd - 文件新增回调
   * @param {Function} options.onChange - 文件变更回调
   * @param {Function} options.onUnlink - 文件删除回调
   */
  async watch(enable = true, options = {}) {
    if (!enable) {
      await this.stop()
      return
    }

    if (this.watcher) {
      BotUtil.makeLog('debug', '文件监视已启动', this.loggerName)
      return
    }

    try {
      const { dirs, onAdd, onChange, onUnlink } = options
      
      if (!dirs || (Array.isArray(dirs) && dirs.length === 0)) {
        BotUtil.makeLog('debug', '未找到要监视的目录，跳过文件监视', this.loggerName)
        return
      }

      this.watcher = chokidar.watch(dirs, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: this.awaitWriteFinish
      })

      // 文件新增
      if (onAdd) {
        this.watcher.on('add', lodash.debounce(async (filePath) => {
          if (!this.isValidFile(filePath)) return
          try {
            await onAdd(filePath)
          } catch (error) {
            BotUtil.makeLog('error', `处理文件新增失败: ${filePath}`, this.loggerName, error)
          }
        }, this.debounceDelay))
      }

      // 文件变更
      if (onChange) {
        this.watcher.on('change', lodash.debounce(async (filePath) => {
          if (!this.isValidFile(filePath)) return
          try {
            await onChange(filePath)
          } catch (error) {
            BotUtil.makeLog('error', `处理文件变更失败: ${filePath}`, this.loggerName, error)
          }
        }, this.debounceDelay))
      }

      // 文件删除
      if (onUnlink) {
        this.watcher.on('unlink', lodash.debounce(async (filePath) => {
          if (!this.isValidFile(filePath)) return
          try {
            await onUnlink(filePath)
          } catch (error) {
            BotUtil.makeLog('error', `处理文件删除失败: ${filePath}`, this.loggerName, error)
          }
        }, this.debounceDelay))
      }

      // 错误处理
      this.watcher.on('error', (error) => {
        BotUtil.makeLog('error', '文件监视错误', this.loggerName, error)
      })

      BotUtil.makeLog('info', '文件监视已启动', this.loggerName)
    } catch (error) {
      BotUtil.makeLog('error', '启动文件监视失败', this.loggerName, error)
    }
  }

  /**
   * 停止文件监视
   */
  async stop() {
    if (this.watcher) {
      try {
        await this.watcher.close()
        this.watcher = null
        BotUtil.makeLog('debug', '文件监视已停止', this.loggerName)
      } catch (error) {
        BotUtil.makeLog('error', '停止文件监视失败', this.loggerName, error)
      }
    }
  }

  /**
   * 获取文件key（不含扩展名）
   * @param {string} filePath - 文件路径
   * @returns {string}
   */
  getFileKey(filePath) {
    return path.basename(filePath, '.js')
  }
}
