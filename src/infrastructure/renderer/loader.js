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

global.Renderer = Renderer

class RendererLoader {
  constructor() {
    this.renderers = new Map()
    this.watcher = null
    this._loadPromise = null
  }

  async load() {
    if (this._loadPromise) return this._loadPromise
    this._loadPromise = this._doLoad()
    return this._loadPromise
  }

  async _doLoad() {
    const baseDir = paths.renderers
    if (!fsSync.existsSync(baseDir)) {
      BotUtil.makeLog('warn', `渲染器目录不存在: ${baseDir}`, 'RendererLoader')
      return
    }
    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await this._loadRenderer(entry.name, baseDir)
      } catch (err) {
        BotUtil.makeLog('error', `渲染器加载失败: ${entry.name} - ${err.message}`, 'RendererLoader', err)
      }
    }
    const loaded = [...this.renderers.keys()]
    if (loaded.length) BotUtil.makeLog('info', `已加载渲染器: ${loaded.join(', ')}`, 'RendererLoader')
    else BotUtil.makeLog('warn', '未加载任何渲染器，帮助页截图不可用', 'RendererLoader')
  }

  async _loadRenderer(name, baseDir) {
    const indexJs = path.join(baseDir, name, 'index.js')
    if (!fsSync.existsSync(indexJs)) return
    const rendererCfg = cfg.getRendererConfig(name) || {}
    const factory = (await import(pathToFileURL(indexJs).href)).default
    const renderer = factory(rendererCfg)
    if (!renderer?.id || !lodash.isFunction(renderer.render)) {
      BotUtil.makeLog('warn', `渲染器无效(缺 id/render): ${name}`, 'RendererLoader')
      return
    }
    this.renderers.set(renderer.id, renderer)
  }

  getRenderer(name = cfg.agt?.browser?.renderer || 'puppeteer') {
    if (this.renderers.size === 0 && !this._loadPromise) {
      void this.load()
    }
    let r = this.renderers.get(name)
    if (r && typeof r.render === 'function') return r
    r = this.renderers.get('puppeteer') || this.renderers.get('playwright')
    return r || {}
  }

  async ensureLoaded() {
    if (this.renderers.size > 0) return
    this._loadPromise = null
    await this.load()
  }

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

const loader = new RendererLoader()
export default loader