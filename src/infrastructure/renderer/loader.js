import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import lodash from "lodash"
import chokidar from "chokidar"
import cfg from "#infrastructure/config/config.js"
import Renderer from "./Renderer.js"
import paths from "#utils/paths.js"
import BotUtil from "#utils/botutil.js"

// 注意：渲染器需要监视目录变化（addDir/unlinkDir），HotReloadBase只支持文件监视
// 因此保留直接使用chokidar的方式

// 暴露 Renderer 构造，仅一次
global.Renderer = Renderer

class RendererLoader {
  constructor() {
    this.renderers = new Map()
    this.watcher = null
  }

  static async init() {
    const render = new RendererLoader()
    await render.load()
    return render
  }

  async load() {
    const baseDir = paths.renderers
    if (!fsSync.existsSync(baseDir)) {
      BotUtil.makeLog('warn', `渲染器目录不存在: ${baseDir}，跳过加载`, 'RendererLoader');
      return
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await this._loadRenderer(entry.name, baseDir)
        } catch (err) {
          BotUtil.makeLog('error', `渲染器加载失败: ${entry.name} - ${err.message}`, 'RendererLoader', err);
        }
      }
    }
  }

  async _loadRenderer(name, baseDir) {
    const indexJs = path.join(baseDir, name, "index.js")
    if (!fsSync.existsSync(indexJs)) return

    const rendererCfg = cfg.getRendererConfig(name) || {}
    const rendererFn = (await import(pathToFileURL(indexJs).href)).default
    const renderer = rendererFn(rendererCfg)

    if (!renderer.id || !renderer.type || !renderer.render || !lodash.isFunction(renderer.render)) {
      BotUtil.makeLog('warn', `渲染器配置无效: ${name}`, 'RendererLoader');
      return false
    }
    this.renderers.set(renderer.id, renderer)
    return true
  }

  getRenderer(name = cfg.agt?.browser?.renderer || "puppeteer") {
    return this.renderers.get(name) || {}
  }

  /**
   * 启用文件监视（热加载）
   * @param {boolean} enable - 是否启用
   */
  async watch(enable = true) {
    if (!enable) {
      if (this.watcher) {
        await this.watcher.close()
        this.watcher = null
      }
      return
    }

    if (this.watcher) return

    const baseDir = paths.renderers
    if (!fsSync.existsSync(baseDir)) return

    try {
      // 渲染器需要监视目录变化，使用chokidar直接监视目录
      const watcher = chokidar.watch(baseDir, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
      }})

      const handleRendererChange = async (filePath, eventType) => {
        try {
          if (eventType === 'addDir') {
            await this._loadRenderer(path.basename(filePath), baseDir)
          } else if (eventType === 'change') {
            const dirName = path.basename(path.dirname(filePath))
            const fileName = path.basename(filePath)
            if (fileName === 'index.js' || fileName === 'config.yaml') {
              await this._loadRenderer(dirName, baseDir)
            }
          } else if (eventType === 'unlinkDir') {
            this.renderers.delete(path.basename(filePath))
          }
        } catch (error) {
          BotUtil.makeLog('error', `处理渲染器${eventType}失败`, 'RendererLoader', error)
        }
      }

      watcher
        .on('addDir', lodash.debounce((dirPath) => handleRendererChange(dirPath, 'addDir'), 500))
        .on('change', lodash.debounce((filePath) => handleRendererChange(filePath, 'change'), 500))
        .on('unlinkDir', lodash.debounce((dirPath) => handleRendererChange(dirPath, 'unlinkDir'), 500))
        .on('error', (error) => {
          BotUtil.makeLog('error', '渲染器文件监视错误', 'RendererLoader', error)
        })

      this.watcher = watcher
    } catch (error) {
      BotUtil.makeLog('error', '启动渲染器文件监视失败', 'RendererLoader', error)
    }
  }
}

export default await RendererLoader.init()